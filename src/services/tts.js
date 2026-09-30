const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { GoogleAuth } = require('google-auth-library');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Supported high-fidelity voices: Google Cloud Studio & WaveNet (with Edge TTS fallbacks)
const PERSONA_VOICES = {
  // Malay personas
  yasmin: 'ms-MY-Wavenet-A', // Malay (Female WaveNet)
  osman: 'ms-MY-Wavenet-B',  // Malay (Male WaveNet)
  // English personas
  guy: 'en-US-Studio-Q',     // English (Male Google Studio)
  jenny: 'en-US-Studio-O',   // English (Female Google Studio)
};

// Default persona per language:
// Malay -> ms-MY-Wavenet-B (Male) or ms-MY-Wavenet-A (Female)
// English -> en-US-Studio-Q (Male Studio)
const DEFAULT_VOICES = {
  ms: 'ms-MY-Wavenet-B',
  en: 'en-US-Studio-Q',
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
  resolveVoice(langCode, sampleText = '', requestedVoice = null) {
    if (requestedVoice && PERSONA_VOICES[requestedVoice.toLowerCase()]) {
      return PERSONA_VOICES[requestedVoice.toLowerCase()];
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

    const selectedVoice = voice || this.defaultVoice;

    // Try Google Cloud Text-to-Speech first (Studio-Q & WaveNet HD)
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

    // Resolve languageCode from voice name
    let languageCode = 'en-US';
    if (voiceName.startsWith('ms-') || voiceName.includes('Wavenet-A') || voiceName.includes('Wavenet-B')) {
      languageCode = 'ms-MY';
    } else if (voiceName.startsWith('id-')) {
      languageCode = 'id-ID';
    }

    // Map old Edge voice names if passed
    let gcpVoice = voiceName;
    if (voiceName.includes('Yasmin')) gcpVoice = 'ms-MY-Wavenet-A';
    else if (voiceName.includes('Osman')) gcpVoice = 'ms-MY-Wavenet-B';
    else if (voiceName.includes('Guy')) gcpVoice = 'en-US-Studio-Q';
    else if (voiceName.includes('Jenny')) gcpVoice = 'en-US-Studio-O';

    const res = await this.gcpClient.request({
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
          speakingRate: 1.06, // Natural snappy conversational speed
          pitch: 0.0,
        },
      },
    });

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
    let edgeVoice = voiceName;
    if (voiceName.includes('Studio-Q') || voiceName.includes('Guy')) edgeVoice = 'en-US-GuyNeural';
    else if (voiceName.includes('Studio-O') || voiceName.includes('Jenny')) edgeVoice = 'en-US-JennyNeural';
    else if (voiceName.includes('Wavenet-B') || voiceName.includes('Osman')) edgeVoice = 'ms-MY-OsmanNeural';
    else if (voiceName.includes('Wavenet-A') || voiceName.includes('Yasmin')) edgeVoice = 'ms-MY-YasminNeural';

    const tts = new MsEdgeTTS();
    await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);

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
};
