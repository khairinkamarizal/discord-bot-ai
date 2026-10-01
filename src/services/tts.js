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

// Supported high-fidelity voices: Google Cloud Studio, Casual & WaveNet (with Edge TTS fallbacks)
const PERSONA_VOICES = {
  // Malay personas
  yasmin: 'ms-MY-Wavenet-A', // Malay (Female WaveNet HD)
  osman: 'ms-MY-Wavenet-B',  // Malay (Male WaveNet HD)
  // English personas
  casual: 'en-US-Casual-K',  // English (Male Conversational Casual HD)
  guy: 'en-US-Studio-Q',     // English (Male Google Studio HD)
  jenny: 'en-US-Studio-O',   // English (Female Google Studio HD)
};

// Default persona per language:
// Malay -> ms-MY-Wavenet-B (Male WaveNet HD)
// English -> en-US-Casual-K (Male Conversational Casual HD)
const DEFAULT_VOICES = {
  ms: 'ms-MY-Wavenet-B',
  en: 'en-US-Casual-K',
};

// Common Malay keywords to assist with language detection
const MALAY_REGEX =
  /\b(siapa|apa|kenapa|mengapa|bila|di mana|dimana|awak|saya|kamu|kita|babi|anjing|kucing|makan|minum|tidur|buat|tak|nak|boleh|tolong|ada|ke|kat|macam|ni|tu|soalan|jawapan|ialah|adalah|otak|kau|aku|bro|weh|sembang|merapu)\b/i;

class TTSService {
  constructor() {
    this.defaultVoice = process.env.TTS_VOICE || DEFAULT_VOICES.en;
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
   * Generates a readable audio stream from text using Google Cloud Studio/WaveNet TTS
   * with automatic fallback to Microsoft Edge TTS.
   * @param {string} text - Clean text to speak
   * @param {string} [voice] - Voice identifier
   * @returns {Promise<import('stream').Readable>}
   */
  async getAudioStream(text, voice = this.defaultVoice) {
    if (!text || !text.trim()) {
      throw new Error('TTS text cannot be empty');
    }

    const selectedVoice = this.resolveVoice(null, text, voice);

    // Try Google Cloud Text-to-Speech first (Casual-K, Studio-Q & WaveNet HD)
    if (this.gcpAuth) {
      try {
        const stream = await this._synthesizeGoogleCloud(text, selectedVoice);
        return stream;
      } catch (err) {
        console.warn(`[TTS] Google Cloud TTS failed for "${selectedVoice}": ${err.message}. Falling back to Edge TTS...`);
      }
    }

    // Fallback to Microsoft Edge TTS (high bitrate 96kbps)
    return this._synthesizeEdgeTTS(text, selectedVoice);
  }

  /**
   * Synthesize using Google Cloud Text-to-Speech REST API.
   * @private
   */
  async _synthesizeGoogleCloud(text, voiceName) {
    if (!this.gcpClient) {
      this.gcpClient = await this.gcpAuth.getClient();
    }

    const lowerVoice = (voiceName || '').toLowerCase();

    // Map persona / Edge voice names if passed
    let gcpVoice = voiceName;
    if (lowerVoice.includes('casual')) gcpVoice = 'en-US-Casual-K';
    else if (lowerVoice.includes('yasmin') || lowerVoice.includes('wavenet-a')) gcpVoice = 'ms-MY-Wavenet-A';
    else if (lowerVoice.includes('osman') || lowerVoice.includes('wavenet-b')) gcpVoice = 'ms-MY-Wavenet-B';
    else if (lowerVoice.includes('guy') || lowerVoice.includes('studio-q')) gcpVoice = 'en-US-Studio-Q';
    else if (lowerVoice.includes('jenny') || lowerVoice.includes('studio-o')) gcpVoice = 'en-US-Studio-O';

    // Resolve languageCode from voice name
    let languageCode = 'en-US';
    if (gcpVoice.startsWith('ms-') || gcpVoice.includes('Wavenet-A') || gcpVoice.includes('Wavenet-B')) {
      languageCode = 'ms-MY';
    } else if (gcpVoice.startsWith('id-')) {
      languageCode = 'id-ID';
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
            speakingRate: 0.96, // Realistic human conversational pace with natural cadence
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
            speakingRate: 0.96,
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
  async _synthesizeEdgeTTS(text, voiceName) {
    const lowerVoice = (voiceName || '').toLowerCase();
    let edgeVoice = 'en-US-GuyNeural';
    if (lowerVoice.includes('casual') || lowerVoice.includes('studio-q') || lowerVoice.includes('guy')) edgeVoice = 'en-US-GuyNeural';
    else if (lowerVoice.includes('studio-o') || lowerVoice.includes('jenny')) edgeVoice = 'en-US-JennyNeural';
    else if (lowerVoice.includes('wavenet-b') || lowerVoice.includes('osman')) edgeVoice = 'ms-MY-OsmanNeural';
    else if (lowerVoice.includes('wavenet-a') || lowerVoice.includes('yasmin')) edgeVoice = 'ms-MY-YasminNeural';

    // Strip any SSML/XML tags for Edge TTS
    const plainText = text.replace(/<[^>]+>/g, '').trim();

    const tts = new MsEdgeTTS();
    await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(plainText, { rate: '-4%' });

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
