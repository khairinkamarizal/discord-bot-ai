const { Transform } = require('stream');

/**
 * A transform stream that accepts 48kHz 16-bit stereo PCM from a music track,
 * and allows mixing an incoming TTS voice stream over it with smooth volume ducking.
 */
class DuckingMixer extends Transform {
  constructor(baseVolume = 0.20, ttsVolume = 0.40) {
    super();
    this.baseVolume = baseVolume;
    this.musicVolume = baseVolume;
    this.ttsVolume = ttsVolume;
    this.ttsBuffer = Buffer.alloc(0);
    this.isSpeaking = false;
    this.ttsInputEnded = false;
    this.fadeTimer = null;
    this.speechEndTimer = null;
  }

  /**
   * Sets the active base music volume.
   * @param {number} vol - 0.01 to 1.0
   */
  setBaseVolume(vol) {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.baseVolume = Math.max(0.01, Math.min(1.0, vol));
    if (!this.isSpeaking) {
      this.musicVolume = this.baseVolume;
    }
  }

  /**
   * Sets the active TTS speech voice volume.
   * @param {number} vol - 0.01 to 1.5
   */
  setTTSVolume(vol) {
    this.ttsVolume = Math.max(0.01, Math.min(1.5, vol));
  }

  /**
   * Smoothly fades the music volume to a target level over durationMs.
   * @param {number} target - Target volume (0.0 to 1.0)
   * @param {number} durationMs - Duration of fade in milliseconds
   */
  fadeMusicVolume(target, durationMs = 500) {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }

    const steps = 15;
    const interval = Math.max(10, Math.floor(durationMs / steps));
    const start = this.musicVolume;
    const stepDiff = (target - start) / steps;
    let i = 0;

    this.fadeTimer = setInterval(() => {
      i++;
      if (i >= steps) {
        this.musicVolume = target;
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      } else {
        this.musicVolume = start + stepDiff * i;
      }
    }, interval);
  }

  /**
   * Called when AI voice begins speaking.
   * Smoothly reduces background music volume to 20% of base.
   */
  startSpeech() {
    if (this.speechEndTimer) {
      clearTimeout(this.speechEndTimer);
      this.speechEndTimer = null;
    }
    this.isSpeaking = true;
    this.ttsInputEnded = false;
    this.fadeMusicVolume(this.baseVolume * 0.2, 400);
  }

  /**
   * Called when TTS stream producer finishes sending all audio chunks for a speech item.
   */
  notifyTTSEnd() {
    this.ttsInputEnded = true;
    if (this.ttsBuffer.length === 0 && this.isSpeaking && !this.speechEndTimer) {
      this.speechEndTimer = setTimeout(() => {
        this.speechEndTimer = null;
        if (this.ttsBuffer.length === 0 && this.isSpeaking) {
          this.emit('itemFinished');
        }
      }, 350);
    }
  }

  /**
   * Called when all speech items have completed or when cancelling speech.
   * Smoothly restores music volume back to base level.
   */
  endSpeech() {
    if (this.speechEndTimer) {
      clearTimeout(this.speechEndTimer);
      this.speechEndTimer = null;
    }
    this.isSpeaking = false;
    this.ttsInputEnded = false;
    this.fadeMusicVolume(this.baseVolume, 750);
    this.emit('speechEnd');
  }

  /**
   * Buffers incoming TTS PCM chunks to be mixed with the music stream.
   * @param {Buffer} chunk
   */
  addTTSChunk(chunk) {
    this.ttsBuffer = Buffer.concat([this.ttsBuffer, chunk]);
  }

  _transform(chunk, encoding, callback) {
    const bytesNeeded = chunk.length;
    let ttsChunk = null;

    if (this.ttsBuffer.length > 0) {
      if (this.ttsBuffer.length >= bytesNeeded) {
        ttsChunk = this.ttsBuffer.subarray(0, bytesNeeded);
        this.ttsBuffer = this.ttsBuffer.subarray(bytesNeeded);
      } else {
        ttsChunk = Buffer.alloc(bytesNeeded, 0);
        this.ttsBuffer.copy(ttsChunk, 0);
        this.ttsBuffer = Buffer.alloc(0);
      }

      // Check if buffer just drained and all chunks were already pushed
      if (this.ttsBuffer.length === 0 && this.ttsInputEnded && this.isSpeaking && !this.speechEndTimer) {
        this.speechEndTimer = setTimeout(() => {
          this.speechEndTimer = null;
          if (this.ttsBuffer.length === 0 && this.isSpeaking) {
            this.emit('itemFinished');
          }
        }, 350);
      }
    }

    const int16Music = new Int16Array(
      chunk.buffer,
      chunk.byteOffset,
      chunk.length / 2
    );
    const int16TTS = ttsChunk
      ? new Int16Array(ttsChunk.buffer, ttsChunk.byteOffset, ttsChunk.length / 2)
      : null;

    const out = new Int16Array(int16Music.length);
    const vol = this.musicVolume;

    for (let i = 0; i < int16Music.length; i++) {
      let sample = int16Music[i] * vol;
      if (int16TTS && i < int16TTS.length) {
        sample += int16TTS[i] * this.ttsVolume;
      }

      // 16-bit PCM integer clipping
      if (sample > 32767) sample = 32767;
      else if (sample < -32768) sample = -32768;

      out[i] = Math.round(sample);
    }

    callback(null, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  }

  destroy(err) {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.speechEndTimer) {
      clearTimeout(this.speechEndTimer);
      this.speechEndTimer = null;
    }
    this.ttsBuffer = Buffer.alloc(0);
    super.destroy(err);
  }
}

module.exports = {
  DuckingMixer,
};
