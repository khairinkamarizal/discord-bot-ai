const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Map of ISO language codes to the best natural Microsoft Edge Neural voices
const VOICE_MAP = {
  ms: 'ms-MY-YasminNeural', // Bahasa Melayu (Female)
  my: 'ms-MY-YasminNeural',
  id: 'id-ID-GadisNeural', // Bahasa Indonesia (Female)
  en: 'en-US-JennyNeural', // English (Female)
  ja: 'ja-JP-NanamiNeural', // Japanese (Female)
  ko: 'ko-KR-SunHiNeural', // Korean (Female)
  zh: 'zh-CN-XiaoxiaoNeural', // Chinese Mandarin (Female)
  ar: 'ar-SA-ZariyahNeural', // Arabic (Female)
  es: 'es-ES-ElviraNeural', // Spanish (Female)
  fr: 'fr-FR-DeniseNeural', // French (Female)
  de: 'de-DE-KatjaNeural', // German (Female)
  ru: 'ru-RU-SvetlanaNeural', // Russian (Female)
  hi: 'hi-IN-SwaraNeural', // Hindi (Female)
  th: 'th-TH-PremwadeeNeural', // Thai (Female)
  vi: 'vi-VN-HoaiMyNeural', // Vietnamese (Female)
  tl: 'fil-PH-BlessicaNeural', // Tagalog (Female)
  fil: 'fil-PH-BlessicaNeural',
};

// Common Malay keywords to help with detection if tag is missing
const MALAY_REGEX =
  /\b(siapa|apa|kenapa|mengapa|bila|di mana|dimana|awak|saya|kamu|kita|babi|anjing|kucing|makan|minum|tidur|buat|tak|nak|boleh|tolong|ada|ke|kat|macam|ni|tu|soalan|jawapan|ialah|adalah)\b/i;

const INDO_REGEX =
  /\b(apakah|siapakah|mengapa|kenapa|gimana|nggak|bisa|kamu|aku|banget|udah|dong|pertanyaan|adalah)\b/i;

class TTSService {
  constructor() {
    this.defaultVoice = process.env.TTS_VOICE || 'en-US-JennyNeural';
    this.outputFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
  }

  /**
   * Automatically picks the most natural neural voice for the detected language.
   * @param {string} [langCode] - ISO language code (e.g. 'ms', 'en', 'id', 'ja')
   * @param {string} [sampleText] - Text to inspect for Malay/Indonesian keywords as fallback
   * @returns {string} Edge neural voice name
   */
  resolveVoice(langCode, sampleText = '') {
    if (langCode && VOICE_MAP[langCode.toLowerCase()]) {
      return VOICE_MAP[langCode.toLowerCase()];
    }

    if (sampleText) {
      if (MALAY_REGEX.test(sampleText)) {
        return VOICE_MAP.ms;
      }
      if (INDO_REGEX.test(sampleText)) {
        return VOICE_MAP.id;
      }
    }

    return this.defaultVoice;
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
  VOICE_MAP,
};
