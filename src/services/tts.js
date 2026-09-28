const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

class TTSService {
  constructor() {
    // Default voice can be overridden via TTS_VOICE in .env
    // Examples:
    // en-US-JennyNeural (US Female - natural)
    // en-US-GuyNeural (US Male - natural)
    // en-GB-SoniaNeural (UK Female)
    // ms-MY-YasminNeural (Malay Female)
    // ms-MY-OsmanNeural (Malay Male)
    this.voice = process.env.TTS_VOICE || 'en-US-JennyNeural';
    this.outputFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
  }

  /**
   * Generates a readable audio stream from text using Microsoft Edge Neural TTS.
   * Completely free, no API key required.
   * @param {string} text - Clean text to speak
   * @returns {Promise<import('stream').Readable>}
   */
  async getAudioStream(text) {
    if (!text || !text.trim()) {
      throw new Error('TTS text cannot be empty');
    }

    const tts = new MsEdgeTTS();
    await tts.setMetadata(this.voice, this.outputFormat);

    const { audioStream } = tts.toStream(text);

    // Make sure we close socket resources once stream finishes or errors
    const cleanup = () => {
      try {
        tts.close();
      } catch (err) {
        // Ignored
      }
    };

    audioStream.once('close', cleanup);
    audioStream.once('error', (err) => {
      cleanup();
      console.error('TTS audio stream error:', err);
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
};
