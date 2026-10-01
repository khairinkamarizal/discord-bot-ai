const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

class LyriaService {
  constructor() {
    this.projectId = process.env.GCP_PROJECT_ID;
    this.keyFile = this._resolveKeyFile();
    this.auth = null;
    this.cachedClient = null;
    this.tempDir = path.resolve(__dirname, '../../temp');

    if (!fs.existsSync(this.tempDir)) {
      try {
        fs.mkdirSync(this.tempDir, { recursive: true });
      } catch (e) {
        console.warn('Could not create temp directory for Lyria:', e.message);
      }
    }
  }

  _resolveKeyFile() {
    const projectRoot = path.resolve(__dirname, '../../');
    const specified = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (specified) {
      if (path.isAbsolute(specified) && fs.existsSync(specified)) return specified;
      const rootPath = path.resolve(projectRoot, specified);
      if (fs.existsSync(rootPath)) return rootPath;
      const cwdPath = path.resolve(process.cwd(), specified);
      if (fs.existsSync(cwdPath)) return cwdPath;
    }

    const defaultProjectKey = path.resolve(projectRoot, 'gcp-key.json');
    if (fs.existsSync(defaultProjectKey)) return defaultProjectKey;

    const defaultCwdKey = path.resolve(process.cwd(), 'gcp-key.json');
    if (fs.existsSync(defaultCwdKey)) return defaultCwdKey;

    return null;
  }

  async _getAccessToken() {
    if (!this.auth) {
      const authOptions = {
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      };
      if (this.keyFile) {
        authOptions.keyFile = this.keyFile;
      }
      this.auth = new GoogleAuth(authOptions);
    }

    if (!this.projectId) {
      try {
        this.projectId = await this.auth.getProjectId();
      } catch (_) {
        this.projectId = process.env.GCP_PROJECT_ID;
      }
    }

    const client = await this.auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse.token;
  }

  /**
   * Cleans up temporary audio files older than 1 hour.
   */
  _cleanupOldTempFiles() {
    try {
      if (!fs.existsSync(this.tempDir)) return;
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      for (const file of files) {
        if (file.startsWith('lyria_') && file.endsWith('.mp3')) {
          const filePath = path.join(this.tempDir, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > 3600000) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Builds an optimized text prompt for Google Lyria 3 based on mode, genre, mood, vocal, and inputs.
   */
  buildPrompt({ mode = 'sing', topic, target, genre, mood, vocal }) {
    const isMalay = /[\b(aku|kau|dia|kami|kita|orang|lepak|mamak|makan|kawan|member|nak|tak|dah|pun|je|weh|bodo|seratus|hujan|malam|petang|rojak|teh|kopi|nasi|lemak|rindu|sayang|cinta)\b]/i.test(
      `${topic} ${target || ''} ${genre || ''}`
    );

    // If custom genre is provided, prioritize it
    if (genre && genre.trim()) {
      const g = genre.trim();
      const m = mood ? `${mood} ` : '';
      const v = vocal ? `${vocal} ` : 'expressive vocals ';
      let p = `A ${m}${g} track featuring ${v}singing with catchy melodic phrasing and authentic production about ${topic}`;
      if (target) p += `, dedicated to ${target}`;
      if (isMalay) p += '. Incorporate Malaysian nuances, flow, and cultural feel naturally into the track.';
      return p;
    }

    const vocalStyle = vocal || (mode === 'rap' || mode === 'diss' ? 'male rapper' : 'male singer');
    const moodStyle = mood ? `${mood} ` : '';

    let prompt = '';
    switch (mode) {
      case 'rap':
        prompt = `A ${moodStyle}90s boom-bap hip-hop track at 90-95 BPM with punchy 12-bit MPC drum break, Fender Rhodes electric piano, deep upright bassline, and a confident ${vocalStyle} spitting rhythmic rhyming bars about ${topic}`;
        if (target) prompt += `, with clever punchlines dedicated to ${target}`;
        if (isMalay) prompt += '. Blend urban Malaysian slang and culture naturally into the lyrics.';
        break;

      case 'diss':
        prompt = `A ${moodStyle}hard-hitting modern trap hip-hop track with heavy 808 bass, punchy drums, and a charismatic ${vocalStyle} spitting clever, witty roast bars about ${target ? `${target} (${topic})` : topic}`;
        if (isMalay) prompt += '. Keep the diss playful, funny, and rooted in Malaysian banter.';
        break;

      case 'poem':
        prompt = `A ${moodStyle}atmospheric neo-soul and lofi jazz track with lush electric piano chords, soft vinyl warmth, and a ${vocalStyle} reciting poetic rhythmic verses about ${topic}`;
        if (isMalay) prompt += ' formatted as modern Malay pantun and poetry.';
        break;

      case 'sing':
      default:
        prompt = `A ${moodStyle}soulful acoustic pop and R&B ballad with warm acoustic guitar chords, gentle percussion, and an emotional ${vocalStyle} delivering a catchy melodic vocal performance about ${topic}`;
        if (target) prompt += ` dedicated to ${target}`;
        if (isMalay) prompt += '. Sing with heartfelt Malaysian feeling and acoustic soul vibe.';
        break;
    }

    return prompt;
  }

  /**
   * Generates a complete studio song with real vocals, melody, and instruments using Google Lyria 3.
   * @param {object} options
   * @param {'sing'|'rap'|'diss'|'poem'} [options.mode='sing']
   * @param {string} options.topic
   * @param {string} [options.target]
   * @param {string} [options.genre]
   * @param {string} [options.mood]
   * @param {string} [options.vocal]
   * @param {string} [options.customPrompt]
   * @returns {Promise<{ audioPath: string, timedLyrics: string, cleanLyrics: string, caption: string, bpm: string, audioBuffer: Buffer }>}
   */
  async generateSong({ mode = 'sing', topic, target, genre, mood, vocal, customPrompt }) {
    this._cleanupOldTempFiles();

    const accessToken = await this._getAccessToken();
    const projectId = this.projectId || process.env.GCP_PROJECT_ID;

    if (!projectId) {
      throw new Error('GCP_PROJECT_ID is not configured.');
    }

    const promptText =
      customPrompt || this.buildPrompt({ mode, topic, target, genre, mood, vocal });
    const url = `https://aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/global/interactions`;

    console.log(`🎵 [Lyria 3] Requesting song generation for mode "${mode}": "${promptText.slice(0, 100)}..."`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: 'lyria-3-clip-preview',
        input: [{ type: 'text', text: promptText }],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(errorText);
      } catch (_) {}
      const errMsg = parsed?.error?.message || errorText || `HTTP ${res.status}`;
      throw new Error(`Lyria 3 generation failed: ${errMsg}`);
    }

    const data = await res.json();
    const outputs = data.outputs || [];

    // Extract outputs
    const audioOutput = outputs.find((o) => o.type === 'audio' && o.data);
    if (!audioOutput) {
      throw new Error('Lyria 3 did not return audio data.');
    }

    const audioBuffer = Buffer.from(audioOutput.data, 'base64');

    // Find lyrics text (contains timestamp format [0.0:] or similar)
    const lyricsOutput = outputs.find(
      (o) => o.type === 'text' && (o.text.includes('[') || !o.text.startsWith('Caption:'))
    );
    const timedLyrics = lyricsOutput ? lyricsOutput.text.trim() : '';

    // Strip timestamps like [0.0:] or [2.5:5.0] for clean readability
    const cleanLyrics = timedLyrics
      .replace(/\[\d+(?:\.\d+)?(?::\d+(?:\.\d+)?)?\]\s*/g, '')
      .trim();

    // Find caption/description text
    const captionOutput = outputs.find(
      (o) => o.type === 'text' && o.text.startsWith('Caption:')
    );
    let caption = captionOutput ? captionOutput.text.trim() : '';
    let bpm = '';

    const bpmMatch = caption.match(/BPM:\s*([\d\.]+)/i);
    if (bpmMatch) {
      bpm = bpmMatch[1];
    }

    // Save temporary audio file for voice player streaming
    const filename = `lyria_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`;
    const audioPath = path.join(this.tempDir, filename);
    fs.writeFileSync(audioPath, audioBuffer);

    console.log(`✅ [Lyria 3] Song generated successfully (${audioBuffer.length} bytes) -> ${audioPath}`);

    return {
      audioPath,
      timedLyrics,
      cleanLyrics,
      caption,
      bpm,
      audioBuffer,
    };
  }
}

module.exports = { LyriaService };
