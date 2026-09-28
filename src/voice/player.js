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
     *   queue: Array<{ text: string, question?: string, onStart?: Function, onEnd?: Function }>,
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

    // If already in the exact same channel and connection is ready, reuse
    if (guildState && guildState.channelId === channel.id && guildState.connection.state.status === VoiceConnectionStatus.Ready) {
      return guildState;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    // Wait until connection is ready
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer();
    connection.subscribe(player);

    guildState = {
      connection,
      player,
      queue: [],
      isPlaying: false,
      channelId: channel.id,
      channelName: channel.name,
    };

    this.guilds.set(guildId, guildState);

    // Audio player event listeners
    player.on(AudioPlayerStatus.Idle, () => {
      this.playNext(guildId);
    });

    player.on('error', (err) => {
      console.error(`Audio player error in guild ${guildId}:`, err);
      this.playNext(guildId);
    });

    // Handle connection state changes and unexpected disconnects
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Reconnecting successfully
      } catch (e) {
        // Disconnect was permanent
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
      try {
        guildState.player.stop();
      } catch (e) {}
      try {
        guildState.connection.destroy();
      } catch (e) {}
      this.guilds.delete(guildId);
      return true;
    }

    // Check if there is an unmanaged connection
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
   * Enqueues text to be spoken via TTS in the guild's connected voice channel.
   * @param {string} guildId
   * @param {string} text - Clean spoken text
   * @param {object} meta - Optional callbacks or question info
   */
  async speak(guildId, text, meta = {}) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) {
      throw new Error('Bot is not connected to a voice channel in this server.');
    }

    guildState.queue.push({ text, ...meta });

    if (!guildState.isPlaying) {
      await this.playNext(guildId);
    }
  }

  /**
   * Stops currently playing audio and clears the queue.
   * @param {string} guildId
   */
  stop(guildId) {
    const guildState = this.guilds.get(guildId);
    if (guildState) {
      guildState.queue = [];
      guildState.isPlaying = false;
      guildState.player.stop();
      return true;
    }
    return false;
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
      return;
    }

    const currentItem = guildState.queue.shift();
    guildState.isPlaying = true;

    try {
      if (currentItem.onStart) {
        currentItem.onStart();
      }

      const stream = await this.ttsService.getAudioStream(currentItem.text);
      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
      });

      guildState.player.play(resource);
    } catch (err) {
      console.error(`Failed to play TTS audio for guild ${guildId}:`, err);
      if (currentItem.onError) {
        currentItem.onError(err);
      }
      // Continue to next item
      this.playNext(guildId);
    }
  }

  /**
   * Checks if bot is connected in a guild.
   * @param {string} guildId
   * @returns {boolean}
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
