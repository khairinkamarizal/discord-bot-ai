const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Supported voices: 2 languages with distinct male/female personas
const PERSONA_VOICES = {
  yasmin: 'ms-MY-YasminNeural', // Malay (Female)
  osman: 'ms-MY-OsmanNeural',   // Malay (Male)
  guy: 'en-US-GuyNeural',       // English (Male)
  jenny: 'en-US-JennyNeural',   // English (Female)
};

// Default persona per language:
// Malay -> Yasmin (Female)
// English -> Guy (Male) - Different person!
const DEFAULT_VOICES = {
  ms: 'ms-MY-YasminNeural',
  en: 'en-US-GuyNeural',
};

// Common Malay keywords to help with detection if tag is missing
const MALAY_REGEX =
  /\b(siapa|apa|kenapa|mengapa|bila|di mana|dimana|awak|saya|kamu|kita|babi|anjing|kucing|makan|minum|tidur|buat|tak|nak|boleh|tolong|ada|ke|kat|macam|ni|tu|soalan|jawapan|ialah|adalah)\b/i;

class TTSService {
  constructor() {
    this.defaultVoice = process.env.TTS_VOICE || DEFAULT_VOICES.en;
    this.outputFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
  }

  /**
   * Resolves neural voice based on language (Malay: Yasmin / English: Guy) or requested persona.
   * @param {string} [langCode] - 'ms' or 'en'
   * @param {string} [sampleText] - Text to inspect for Malay keywords
   * @param {string} [requestedVoice] - Optional specific persona ('yasmin', 'osman', 'guy', 'jenny')
   * @returns {string} Edge neural voice name
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
   * Generates a readable audio stream from text using Microsoft Edge Neural TTS.
   * @param {string} text - Clean text to speak
   * @param {string} [voice] - Optional specific neural voice name
   * @returns {Promise<import('stream').Readable>}
   */
  async getAudioStream(text, voice = this.defaultVoice) {
    if (!text || !text.trim()) {
      throw new Error('TTS text cannot be empty');
    }

    const tts = new MsEdgeTTS();
    const selectedVoice = voice || this.defaultVoice;
    await tts.setMetadata(selectedVoice, this.outputFormat);

    const { audioStream } = tts.toStream(text);

    const cleanup = () => {
      try {
        tts.close();
      } catch (err) {
        // Ignored
      }
    };

    audioStream.once('close', cleanup);
    audioStream.once('end', cleanup);
    audioStream.on('error', (err) => {
      cleanup();
      if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error(`TTS audio stream error [${selectedVoice}]:`, err);
      }
    });

    return audioStream;
  }

  /**
   * Fetch list of available voices.
   */
  async getAvailableVoices() {
    const tts = new MsEdgeTTS();
    try {
      const voices = await tts.getVoices();
      tts.close();
      return voices;
    } catch (err) {
      tts.close();
      throw err;
    }
  }
}

module.exports = {
  TTSService,
  PERSONA_VOICES,
  DEFAULT_VOICES,
};
