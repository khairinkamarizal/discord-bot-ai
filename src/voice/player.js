const prism = require('prism-media');

// Prefer system FFmpeg binary over bundled static binaries (which hang on HTTPS streams in Linux)
const systemFFmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
prism.FFmpeg.getInfo = () => ({
  command: systemFFmpeg,
  output: 'system ffmpeg',
  version: 'system',
});

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');

const { TTSService } = require('../services/tts');
const { DuckingMixer } = require('./duckingMixer');

class VoiceManager {
  constructor() {
    this.ttsService = new TTSService();
    /**
     * Map of guildId -> {
     *   connection: VoiceConnection,
     *   player: AudioPlayer,
     *   queue: Array<object>,
     *   currentTrack: object | null,
     *   activeMixer: DuckingMixer | null,
     *   musicFFmpeg: prism.FFmpeg | null,
     *   isPlaying: boolean,
     *   channelId: string,
     *   channelName: string,
     * }
     */
    this.guilds = new Map();
  }

  /**
   * Joins a voice channel and keeps connection open indefinitely until /disconnect.
   * @param {import('discord.js').VoiceChannel | import('discord.js').StageChannel} channel
   */
  async join(channel) {
    const guildId = channel.guild.id;
    let guildState = this.guilds.get(guildId);

    // If already in the exact same channel and ready, reuse
    if (
      guildState &&
      guildState.channelId === channel.id &&
      guildState.connection.state.status === VoiceConnectionStatus.Ready
    ) {
      return guildState;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    connection.on('stateChange', (oldState, newState) => {
      console.log(`🔊 Voice [${channel.guild.name} #${channel.name}]: ${oldState.status} ➔ ${newState.status}`);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (err) {
      console.error(`🔊 Failed to reach Ready state for #${channel.name}. Current state: ${connection.state.status}`);
      throw err;
    }

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });
    connection.subscribe(player);

    guildState = {
      connection,
      player,
      queue: [],
      currentTrack: null,
      activeMixer: null,
      musicFFmpeg: null,
      currentResource: null,
      volume: 0.5, // 50% comfortable default volume
      isPlaying: false,
      channelId: channel.id,
      channelName: channel.name,
    };

    this.guilds.set(guildId, guildState);

    // Audio player state tracking and logging
    player.on('stateChange', (oldState, newState) => {
      console.log(`🎵 Player [${channel.guild.name} #${channel.name}]: ${oldState.status} ➔ ${newState.status}`);
    });

    // Advance queue on track completion
    player.on(AudioPlayerStatus.Idle, () => {
      this.playNext(guildId);
    });

    player.on('error', (err) => {
      console.error(`Audio player error in guild ${guildId}:`, err);
      this.playNext(guildId);
    });

    // Connection lifecycle listeners
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch (e) {
        this.disconnect(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.disconnect(guildId);
    });

    return guildState;
  }

  /**
   * Disconnects from the voice channel in a guild and cleans up all audio streams.
   * @param {string} guildId
   */
  disconnect(guildId) {
    const guildState = this.guilds.get(guildId);
    if (guildState) {
      guildState.queue = [];
      guildState.currentTrack = null;
      guildState.isPlaying = false;
      this._cleanupStreams(guildState);

      try {
        guildState.player.stop(true);
      } catch (e) {}
      try {
        guildState.connection.destroy();
      } catch (e) {}
      this.guilds.delete(guildId);
      return true;
    }

    const existing = getVoiceConnection(guildId);
    if (existing) {
      try {
        existing.destroy();
      } catch (e) {}
      return true;
    }

    return false;
  }

  /**
   * Helper to clean up active FFmpeg and Mixer streams for a guild.
   * @private
   */
  _cleanupStreams(guildState) {
    guildState.currentResource = null;
    if (guildState.musicFFmpeg) {
      try {
        guildState.musicFFmpeg.destroy();
      } catch (e) {}
      guildState.musicFFmpeg = null;
    }
    if (guildState.activeMixer) {
      try {
        guildState.activeMixer.destroy();
      } catch (e) {}
      guildState.activeMixer = null;
    }
  }

  /**
   * Queues or immediately plays a song with real-time ducking capability.
   * @param {string} guildId
   * @param {object} song - Song metadata including streamUrl
   * @returns {{ isPlayingNow: boolean, position: number }}
   */
  async playSong(guildId, song) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) {
      throw new Error('Bot is not connected to a voice channel.');
    }

    const item = {
      type: 'song',
      ...song,
    };

    if (!guildState.isPlaying) {
      guildState.queue.push(item);
      await this.playNext(guildId);
      return { isPlayingNow: true, position: 0 };
    } else {
      guildState.queue.push(item);
      return { isPlayingNow: false, position: guildState.queue.length };
    }
  }

  /**
   * Speaks AI answer in voice.
   * IF a song is playing: Smoothly ducks song volume to 20%, speaks over the background music,
   * then restores song volume back to 100% when finished!
   * IF no song is playing: Plays voice directly.
   * @param {string} guildId
   * @param {string} speechText
   * @param {object} meta
   */
  async speak(guildId, speechText, meta = {}) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) {
      throw new Error('Bot is not connected to a voice channel.');
    }

    // CASE 1: Song is currently playing with active mixer -> Duck & overlay!
    if (guildState.isPlaying && guildState.activeMixer) {
      const mixer = guildState.activeMixer;

      // 1. Slowly lower music volume to 20%
      mixer.startSpeech();

      try {
        // 2. Generate TTS audio stream with language-specific voice
        const ttsStream = await this.ttsService.getAudioStream(speechText, meta.voice);

        // 3. Transcode TTS stream to 48kHz 16-bit stereo PCM
        const ttsFFmpeg = new prism.FFmpeg({
          args: [
            '-nostdin',
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
          ],
        });

        ttsStream.on('error', (err) => {
          console.error('TTS stream error during ducking:', err);
          finishSpeech();
        });

        ttsStream.pipe(ttsFFmpeg);

        ttsFFmpeg.on('data', (chunk) => {
          mixer.addTTSChunk(chunk);
        });

        ttsFFmpeg.once('end', () => {
          mixer.notifyTTSEnd();
        });

        ttsFFmpeg.once('error', (err) => {
          console.error('TTS FFmpeg error during ducking:', err);
          mixer.endSpeech();
        });
      } catch (err) {
        console.error('Failed to overlay TTS speech over music:', err);
        mixer.endSpeech();
      }
      return;
    }

    // CASE 2: No song is playing -> Play standalone voice response
    const item = {
      type: 'tts',
      text: speechText,
      ...meta,
    };

    if (guildState.isPlaying) {
      guildState.queue.unshift(item);
      guildState.player.stop(true);
    } else {
      guildState.queue.push(item);
      await this.playNext(guildId);
    }
  }

  /**
   * Advances and plays the next item in the audio queue.
   * @param {string} guildId
   */
  async playNext(guildId) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) return;

    this._cleanupStreams(guildState);

    if (guildState.queue.length === 0) {
      guildState.isPlaying = false;
      guildState.currentTrack = null;
      return;
    }

    const currentItem = guildState.queue.shift();
    guildState.currentTrack = currentItem;
    guildState.isPlaying = true;

    try {
      if (currentItem.type === 'song') {
        // Create DuckingMixer to allow real-time background voice ducking with configured volume
        const mixer = new DuckingMixer(guildState.volume ?? 0.5);
        guildState.activeMixer = mixer;

        // Build FFmpeg args using system ffmpeg with -nostdin to prevent blocking
        const ffmpegArgs = [
          '-nostdin',
          '-analyzeduration', '0',
          '-loglevel', '0',
        ];

        let isStreamInput = false;
        if (typeof currentItem.streamUrl === 'string') {
          ffmpegArgs.push('-i', currentItem.streamUrl);
        } else if (currentItem.streamUrl && typeof currentItem.streamUrl.pipe === 'function') {
          isStreamInput = true;
        }

        ffmpegArgs.push(
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
        );

        const musicFFmpeg = new prism.FFmpeg({
          args: ffmpegArgs,
        });
        guildState.musicFFmpeg = musicFFmpeg;

        if (isStreamInput) {
          currentItem.streamUrl.pipe(musicFFmpeg);
        }

        musicFFmpeg.pipe(mixer);

        musicFFmpeg.on('error', (err) => {
          console.error(`Music stream FFmpeg error for "${currentItem.title}":`, err);
          this.playNext(guildId);
        });

        mixer.on('error', (err) => {
          console.error(`Mixer stream error for "${currentItem.title}":`, err);
          this.playNext(guildId);
        });

        // Feed mixed raw PCM into AudioPlayer
        const resource = createAudioResource(mixer, {
          inputType: StreamType.Raw,
        });
        guildState.currentResource = resource;

        guildState.player.play(resource);
      } else {
        // Standalone TTS speech
        const stream = await this.ttsService.getAudioStream(currentItem.text, currentItem.voice);
        const resource = createAudioResource(stream, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true,
        });
        resource.volume?.setVolume(guildState.volume ?? 0.5);
        guildState.currentResource = resource;
        guildState.player.play(resource);
      }
    } catch (err) {
      console.error(`Failed to play audio in guild ${guildId}:`, err);
      this.playNext(guildId);
    }
  }

  /**
   * Skips currently playing song/speech to the next in queue.
   * @param {string} guildId
   * @returns {object | null}
   */
  skip(guildId) {
    const guildState = this.guilds.get(guildId);
    if (!guildState || !guildState.isPlaying) {
      return null;
    }

    const skipped = guildState.currentTrack;
    this._cleanupStreams(guildState);
    guildState.player.stop(true);
    return skipped;
  }

  /**
   * Pauses playback.
   * @param {string} guildId
   */
  pause(guildId) {
    const guildState = this.guilds.get(guildId);
    if (guildState && guildState.isPlaying) {
      return guildState.player.pause();
    }
    return false;
  }

  /**
   * Resumes paused playback.
   * @param {string} guildId
   */
  resume(guildId) {
    const guildState = this.guilds.get(guildId);
    if (guildState) {
      return guildState.player.unpause();
    }
    return false;
  }

  /**
   * Halts playback and empties queue.
   * @param {string} guildId
   */
  stop(guildId) {
    const guildState = this.guilds.get(guildId);
    if (guildState) {
      guildState.queue = [];
      guildState.currentTrack = null;
      guildState.isPlaying = false;
      this._cleanupStreams(guildState);
      guildState.player.stop(true);
      return true;
    }
    return false;
  }

  /**
   * Retrieves current queue status.
   * @param {string} guildId
   */
  getQueue(guildId) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) return null;

    return {
      currentItem: guildState.currentTrack,
      queue: [...guildState.queue],
      isPlaying: guildState.isPlaying,
      isPaused: guildState.player.state.status === AudioPlayerStatus.Paused,
      channelName: guildState.channelName,
    };
  }

  /**
   * Checks if bot is connected in a guild.
   * @param {string} guildId
   */
  isConnected(guildId) {
    return this.guilds.has(guildId);
  }

  /**
   * Gets current state for guild.
   * @param {string} guildId
   */
  getState(guildId) {
    return this.guilds.get(guildId);
  }

  /**
   * Sets playback volume for a guild (0.05 to 1.0).
   * @param {string} guildId
   * @param {number} volume - Float between 0.05 and 1.0
   * @returns {number} The updated volume percentage (5 to 100)
   */
  setVolume(guildId, volume) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) {
      throw new Error('Bot is not connected to a voice channel.');
    }

    const clamped = Math.max(0.05, Math.min(1.0, volume));
    guildState.volume = clamped;

    if (guildState.activeMixer) {
      guildState.activeMixer.setBaseVolume(clamped);
    }
    if (guildState.currentResource?.volume) {
      guildState.currentResource.volume.setVolume(clamped);
    }

    return Math.round(clamped * 100);
  }

  /**
   * Gets current volume percentage for a guild.
   * @param {string} guildId
   * @returns {number} Percentage (5 to 100)
   */
  getVolume(guildId) {
    const guildState = this.guilds.get(guildId);
    return Math.round((guildState?.volume ?? 0.5) * 100);
  }
}

module.exports = {
  VoiceManager,
};
