const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { GoogleAuth } = require('google-auth-library');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

/**
 * Transforms conversational text into expressive SSML with natural human breathing pauses,
 * realistic hesitation breaks, and natural sentence boundaries.
 * @param {string} text
 * @returns {string}
 */
function textToSSML(text) {
  if (!text) return '<speak></speak>';

  // 1. Escape XML special characters
  let ssml = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  // 2. Hesitations and pauses: replace ellipses (...) or (…) with natural hesitation pause
  ssml = ssml.replace(/\.{2,}|…/g, ' <break time="280ms"/> ');

  // 3. Sentence terminators (? ! .) - insert natural breathing pauses
  // Question marks: slightly longer pause for contemplative / questioning effect
  ssml = ssml.replace(/([?!])(\s+|$)/g, '$1 <break time="350ms"/>$2');
  // Full stops: pause on actual sentence ends, avoiding abbreviations (e.g., i.e., vs.) and decimal numbers
  ssml = ssml.replace(/(?<!\b(?:e\.g|i\.e|mr|mrs|dr|prof|vs|\d))\.(?=\s+[A-Z0-9"'‘“a-z]|\s*$)/gi, '. <break time="320ms"/> ');

  // 4. Clause boundaries (commas, semicolons, colons, dashes)
  ssml = ssml.replace(/,(\s+)/g, ', <break time="140ms"/> ');
  ssml = ssml.replace(/[:;](\s+)/g, ' <break time="180ms"/> ');
  ssml = ssml.replace(/\s*—\s*|\s*--\s*/g, ' <break time="200ms"/> ');

  // 5. Clean up redundant whitespace and consecutive break tags
  ssml = ssml.replace(/(<break time="\d+ms"\/>\s*){2,}/g, '<break time="350ms"/> ');
  ssml = ssml.replace(/\s+/g, ' ').trim();

  return `<speak>${ssml}</speak>`;
}

// Supported high-fidelity voices: Google Cloud Chirp 3 HD Generative Models, Studio & WaveNet
const PERSONA_VOICES = {
  // Chirp 3 HD Foundation Models (Google DeepMind Generative Voice)
  puck: 'en-US-Chirp3-HD-Puck',              // Upbeat & Expressive (Chirp 3 HD)
  zuben: 'en-US-Chirp3-HD-Zubenelgenubi',    // Chill & Casual Urban Male (Chirp 3 HD)
  fenrir: 'en-US-Chirp3-HD-Fenrir',          // Energetic Male (Chirp 3 HD)
  despina: 'en-US-Chirp3-HD-Despina',        // Smooth Modern Female (Chirp 3 HD)
  aoede: 'en-US-Chirp3-HD-Aoede',            // Breezy Female (Chirp 3 HD)

  // Regional Personas (Malay/Regional Chirp 3 HD)
  puck_my: 'id-ID-Chirp3-HD-Puck',           // Regional Upbeat Male (Chirp 3 HD)
  zuben_my: 'id-ID-Chirp3-HD-Zubenelgenubi', // Regional Chill Urban Male (Chirp 3 HD)
  aoede_my: 'id-ID-Chirp3-HD-Aoede',         // Regional Breezy Female (Chirp 3 HD)

  // Legacy personas (WaveNet & Studio)
  casual: 'en-US-Casual-K',                  // Conversational Casual Male
  guy: 'en-US-Studio-Q',                     // Studio Male
  jenny: 'en-US-Studio-O',                   // Studio Female
  osman: 'ms-MY-Wavenet-B',                  // Malay Male WaveNet
  yasmin: 'ms-MY-Wavenet-A',                 // Malay Female WaveNet
};

// Default persona per language:
// English -> en-US-Chirp3-HD-Puck (Chirp 3 HD Generative Foundation)
// Malay   -> id-ID-Chirp3-HD-Puck (Chirp 3 HD Generative Foundation)
const DEFAULT_VOICES = {
  ms: 'id-ID-Chirp3-HD-Puck',
  en: 'en-US-Chirp3-HD-Puck',
};

// Common Malay keywords to assist with language detection
const MALAY_REGEX =
  /\b(siapa|apa|kenapa|mengapa|bila|di mana|dimana|awak|saya|kamu|kita|babi|anjing|kucing|makan|minum|tidur|buat|tak|nak|boleh|tolong|ada|ke|kat|macam|ni|tu|soalan|jawapan|ialah|adalah|otak|kau|aku|bro|weh|sembang|merapu)\b/i;

class TTSService {
  constructor() {
    const envVoice = process.env.TTS_VOICE;
    if (!envVoice || envVoice.includes('JennyNeural') || envVoice.includes('GuyNeural')) {
      this.defaultVoice = DEFAULT_VOICES.en;
    } else {
      this.defaultVoice = envVoice;
    }
    this.gcpClient = null;
    this._initGCP();
  }

  /**
   * Initializes Google Cloud TTS client using project key or environment credentials.
   * @private
   */
  _initGCP() {
    try {
      const projectRoot = path.resolve(__dirname, '../../');
      let keyPath = null;

      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const specified = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (path.isAbsolute(specified) && fs.existsSync(specified)) {
          keyPath = specified;
        } else if (fs.existsSync(path.resolve(projectRoot, specified))) {
          keyPath = path.resolve(projectRoot, specified);
        } else if (fs.existsSync(path.resolve(process.cwd(), specified))) {
          keyPath = path.resolve(process.cwd(), specified);
        }
      } else if (fs.existsSync(path.resolve(projectRoot, 'gcp-key.json'))) {
        keyPath = path.resolve(projectRoot, 'gcp-key.json');
      }

      const auth = new GoogleAuth({
        keyFile: keyPath || undefined,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });

      this.gcpAuth = auth;
      console.log('🎙️ Google Cloud Text-to-Speech engine initialized (Studio & WaveNet enabled)');
    } catch (err) {
      console.warn('⚠️ Google Cloud TTS init fallback to Edge TTS:', err.message);
    }
  }

  /**
   * Resolves neural voice based on language (Malay: WaveNet / English: Studio) or requested persona.
   * @param {string} [langCode] - 'ms' or 'en'
   * @param {string} [sampleText] - Text to inspect for Malay keywords
   * @param {string} [requestedVoice] - Optional specific persona ('yasmin', 'osman', 'guy', 'jenny')
   * @returns {string} Voice name
   */
  /**
   * Resolves neural voice based on language (Malay: WaveNet / English: Studio) or requested persona.
   * @param {string} [langCode] - 'ms' or 'en'
   * @param {string} [sampleText] - Text to inspect for Malay keywords
   * @param {string} [requestedVoice] - Optional specific persona ('casual', 'yasmin', 'osman', 'guy', 'jenny') or full voice name
   * @returns {string} Voice name
   */
  resolveVoice(langCode, sampleText = '', requestedVoice = null) {
    if (requestedVoice) {
      const lower = requestedVoice.toLowerCase();
      if (PERSONA_VOICES[lower]) {
        return PERSONA_VOICES[lower];
      }
      if (requestedVoice.includes('-')) {
        return requestedVoice;
      }
    }

    if (langCode === 'ms' || (sampleText && MALAY_REGEX.test(sampleText))) {
      return DEFAULT_VOICES.ms;
    }

    return DEFAULT_VOICES.en;
  }

  /**
   * Generates a readable audio stream from text using Google Cloud Studio/WaveNet/Chirp TTS
   * with automatic fallback to Microsoft Edge TTS.
   * @param {string} text - Clean text to speak
   * @param {string} [voice] - Voice identifier
   * @param {{ mode?: string, speakingRate?: number }} [options] - Optional mode or rate tuning
   * @returns {Promise<import('stream').Readable>}
   */
  async getAudioStream(text, voice = this.defaultVoice, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('TTS text cannot be empty');
    }

    const selectedVoice = this.resolveVoice(null, text, voice);

    // Try Google Cloud Text-to-Speech first (Chirp 3 HD, Casual-K, Studio-Q & WaveNet HD)
    if (this.gcpAuth) {
      try {
        const stream = await this._synthesizeGoogleCloud(text, selectedVoice, options);
        return stream;
      } catch (err) {
        console.warn(`[TTS] Google Cloud TTS failed for "${selectedVoice}": ${err.message}. Falling back to Edge TTS...`);
      }
    }

    // Fallback to Microsoft Edge TTS (high bitrate 96kbps)
    return this._synthesizeEdgeTTS(text, selectedVoice, options);
  }

  /**
   * Synthesize using Google Cloud Text-to-Speech REST API.
   * @private
   */
  async _synthesizeGoogleCloud(text, voiceName, options = {}) {
    if (!this.gcpClient) {
      this.gcpClient = await this.gcpAuth.getClient();
    }

    const lowerVoice = (voiceName || '').toLowerCase();

    // Map persona / voice names if passed
    let gcpVoice = voiceName;
    if (PERSONA_VOICES[lowerVoice]) {
      gcpVoice = PERSONA_VOICES[lowerVoice];
    } else if (lowerVoice.includes('puck_my') || (lowerVoice.includes('puck') && lowerVoice.includes('id'))) {
      gcpVoice = 'id-ID-Chirp3-HD-Puck';
    } else if (lowerVoice.includes('zuben_my') || (lowerVoice.includes('zuben') && (lowerVoice.includes('id') || lowerVoice.includes('my')))) {
      gcpVoice = 'id-ID-Chirp3-HD-Zubenelgenubi';
    } else if (lowerVoice.includes('puck')) {
      gcpVoice = 'en-US-Chirp3-HD-Puck';
    } else if (lowerVoice.includes('zuben') || lowerVoice.includes('zubenelgenubi')) {
      gcpVoice = 'en-US-Chirp3-HD-Zubenelgenubi';
    } else if (lowerVoice.includes('fenrir')) {
      gcpVoice = 'en-US-Chirp3-HD-Fenrir';
    } else if (lowerVoice.includes('despina')) {
      gcpVoice = 'en-US-Chirp3-HD-Despina';
    } else if (lowerVoice.includes('aoede')) {
      gcpVoice = 'en-US-Chirp3-HD-Aoede';
    } else if (lowerVoice.includes('casual')) {
      gcpVoice = 'en-US-Casual-K';
    } else if (lowerVoice.includes('yasmin') || lowerVoice.includes('wavenet-a')) {
      gcpVoice = 'ms-MY-Wavenet-A';
    } else if (lowerVoice.includes('osman') || lowerVoice.includes('wavenet-b')) {
      gcpVoice = 'ms-MY-Wavenet-B';
    } else if (lowerVoice.includes('guy') || lowerVoice.includes('studio-q')) {
      gcpVoice = 'en-US-Studio-Q';
    } else if (lowerVoice.includes('jenny') || lowerVoice.includes('studio-o')) {
      gcpVoice = 'en-US-Studio-O';
    }

    // Resolve languageCode from voice name
    let languageCode = 'en-US';
    if (gcpVoice.startsWith('ms-') || gcpVoice.includes('Wavenet-A') || gcpVoice.includes('Wavenet-B')) {
      languageCode = 'ms-MY';
    } else if (gcpVoice.startsWith('id-')) {
      languageCode = 'id-ID';
    }

    let speakingRate = gcpVoice.includes('Chirp') ? 0.98 : 0.96;
    if (options.speakingRate) {
      speakingRate = options.speakingRate;
    } else if (options.mode === 'rap' || options.mode === 'diss') {
      speakingRate = 1.04;
    } else if (options.mode === 'sing') {
      speakingRate = 0.94;
    } else if (options.mode === 'poem') {
      speakingRate = 0.96;
    }

    const ssml = textToSSML(text);

    let res;
    try {
      res = await this.gcpClient.request({
        url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
        method: 'POST',
        data: {
          input: { ssml },
          voice: {
            languageCode,
            name: gcpVoice,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            sampleRateHertz: 48000,
            speakingRate,
            pitch: 0.0,
          },
        },
      });
    } catch (ssmlErr) {
      console.warn(`[TTS] SSML synthesis failed for ${gcpVoice} (${ssmlErr.message}), falling back to plain text GCP synthesis`);
      res = await this.gcpClient.request({
        url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
        method: 'POST',
        data: {
          input: { text },
          voice: {
            languageCode,
            name: gcpVoice,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            sampleRateHertz: 48000,
            speakingRate,
            pitch: 0.0,
          },
        },
      });
    }

    if (!res.data?.audioContent) {
      throw new Error('Google Cloud TTS returned empty audioContent');
    }

    const audioBuffer = Buffer.from(res.data.audioContent, 'base64');
    return Readable.from(audioBuffer);
  }

  /**
   * Fallback synthesis using Microsoft Edge TTS with 96kbps audio.
   * @private
   */
  async _synthesizeEdgeTTS(text, voiceName, options = {}) {
    const lowerVoice = (voiceName || '').toLowerCase();
    let edgeVoice = 'en-US-GuyNeural';
    if (lowerVoice.includes('despina') || lowerVoice.includes('aoede') || lowerVoice.includes('jenny') || lowerVoice.includes('studio-o')) {
      edgeVoice = 'en-US-JennyNeural';
    } else if (lowerVoice.includes('wavenet-a') || lowerVoice.includes('yasmin')) {
      edgeVoice = 'ms-MY-YasminNeural';
    } else if (lowerVoice.includes('wavenet-b') || lowerVoice.includes('osman')) {
      edgeVoice = 'ms-MY-OsmanNeural';
    } else {
      edgeVoice = 'en-US-GuyNeural';
    }

    // Strip any SSML/XML tags for Edge TTS
    const plainText = text.replace(/<[^>]+>/g, '').trim();

    let rate = '-4%';
    if (options.mode === 'rap' || options.mode === 'diss') rate = '+2%';
    else if (options.mode === 'sing') rate = '-6%';

    const tts = new MsEdgeTTS();
    await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(plainText, { rate });

    const cleanup = () => {
      try {
        tts.close();
      } catch (err) {}
    };

    audioStream.once('close', cleanup);
    audioStream.once('end', cleanup);
    audioStream.on('error', (err) => {
      cleanup();
      if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error(`Edge TTS audio stream error [${edgeVoice}]:`, err.message);
      }
    });

    return audioStream;
  }
}

module.exports = {
  TTSService,
  PERSONA_VOICES,
  DEFAULT_VOICES,
  textToSSML,
};
