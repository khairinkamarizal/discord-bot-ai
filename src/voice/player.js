const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  StreamType,
} = require('@discordjs/voice');
const { TTSService } = require('../services/tts');

class VoiceManager {
  constructor() {
    this.ttsService = new TTSService();
    /**
     * Map of guildId -> {
     *   connection: VoiceConnection,
     *   player: AudioPlayer,
     *   queue: Array<QueueItem>,
     *   currentItem: QueueItem | null,
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

    // If already connected to the same channel and ready, reuse
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

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer();
    connection.subscribe(player);

    guildState = {
      connection,
      player,
      queue: [],
      currentItem: null,
      isPlaying: false,
      channelId: channel.id,
      channelName: channel.name,
    };

    this.guilds.set(guildId, guildState);

    // When current track/speech finishes, advance queue
    player.on(AudioPlayerStatus.Idle, () => {
      this.playNext(guildId);
    });

    player.on('error', (err) => {
      console.error(`Audio player error in guild ${guildId}:`, err);
      this.playNext(guildId);
    });

    // Reconnection & cleanup listeners
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
      this.guilds.delete(guildId);
    });

    return guildState;
  }

  /**
   * Disconnects from the voice channel in a guild and cleans up state.
   * @param {string} guildId
   */
  disconnect(guildId) {
    const guildState = this.guilds.get(guildId);
    if (guildState) {
      guildState.queue = [];
      guildState.currentItem = null;
      guildState.isPlaying = false;
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
   * Queues or immediately plays a song.
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
   * Speaks text aloud in the voice channel (AI response).
   * Prioritizes AI speech so users don't have to wait for an entire song to finish.
   * @param {string} guildId
   * @param {string} speechText
   * @param {object} meta
   */
  async speak(guildId, speechText, meta = {}) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) {
      throw new Error('Bot is not connected to a voice channel.');
    }

    const item = {
      type: 'tts',
      text: speechText,
      ...meta,
    };

    // If currently playing a song, insert the AI speech right at the front and switch
    if (guildState.isPlaying) {
      guildState.queue.unshift(item);
      guildState.player.stop(true); // Triggers Idle -> plays the AI response immediately
    } else {
      guildState.queue.push(item);
      await this.playNext(guildId);
    }
  }

  /**
   * Plays the next item in the audio queue.
   * @param {string} guildId
   */
  async playNext(guildId) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) return;

    if (guildState.queue.length === 0) {
      guildState.isPlaying = false;
      guildState.currentItem = null;
      return;
    }

    const currentItem = guildState.queue.shift();
    guildState.currentItem = currentItem;
    guildState.isPlaying = true;

    try {
      let resource;

      if (currentItem.type === 'song') {
        resource = createAudioResource(currentItem.streamUrl, {
          inputType: StreamType.Arbitrary,
        });
      } else {
        // TTS speech
        const stream = await this.ttsService.getAudioStream(currentItem.text);
        resource = createAudioResource(stream, {
          inputType: StreamType.Arbitrary,
        });
      }

      guildState.player.play(resource);

      if (currentItem.onStart) {
        currentItem.onStart();
      }
    } catch (err) {
      console.error(`Failed to play audio in guild ${guildId}:`, err);
      if (currentItem.onError) {
        currentItem.onError(err);
      }
      this.playNext(guildId);
    }
  }

  /**
   * Skips the currently playing item to the next in queue.
   * @param {string} guildId
   * @returns {object | null} Skipped item
   */
  skip(guildId) {
    const guildState = this.guilds.get(guildId);
    if (!guildState || !guildState.isPlaying) {
      return null;
    }

    const skippedItem = guildState.currentItem;
    guildState.player.stop(true);
    return skippedItem;
  }

  /**
   * Pauses the audio player.
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
   * Resumes the audio player.
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
   * Stops playback and clears the entire queue.
   * @param {string} guildId
   */
  stop(guildId) {
    const guildState = this.guilds.get(guildId);
    if (guildState) {
      guildState.queue = [];
      guildState.currentItem = null;
      guildState.isPlaying = false;
      guildState.player.stop(true);
      return true;
    }
    return false;
  }

  /**
   * Returns current queue information.
   * @param {string} guildId
   */
  getQueue(guildId) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) return null;

    return {
      currentItem: guildState.currentItem,
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
}

module.exports = {
  VoiceManager,
};
