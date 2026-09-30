const fs = require('fs');
const path = require('path');
const prism = require('prism-media');

const STATE_FILE = path.join(__dirname, '../../voice-state.json');

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
    this.musicService = null;
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
   * Sets music service for on-demand stream resolution.
   * @param {import('../services/music').MusicService} musicService
   */
  setMusicService(musicService) {
    this.musicService = musicService;
  }

  saveChannel(guildId, channelId) {
    try {
      let data = {};
      if (fs.existsSync(STATE_FILE)) {
        data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
      data[guildId] = channelId;
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('Failed to save voice channel state:', e.message);
    }
  }

  clearSavedChannel(guildId) {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        delete data[guildId];
        fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
      }
    } catch (e) {
      console.warn('Failed to clear voice channel state:', e.message);
    }
  }

  getSavedChannels() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch (e) {}
    return {};
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
      volume: 0.20, // 20% comfortable default music volume
      isPlaying: false,
      channelId: channel.id,
      channelName: channel.name,
      channel: channel,
      explicitDisconnect: false,
    };

    this.guilds.set(guildId, guildState);
    this.saveChannel(guildId, channel.id);

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

    // Connection lifecycle listeners with auto-recovery
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 10_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 10_000),
        ]);
      } catch (e) {
        if (!guildState.explicitDisconnect) {
          console.log(`🔄 Voice disconnected from #${channel.name}. Auto-reconnecting in 3 seconds...`);
          try {
            connection.destroy();
          } catch (_) {}
          this.guilds.delete(guildId);

          setTimeout(async () => {
            try {
              if (!guildState.explicitDisconnect && !this.isConnected(guildId)) {
                await this.join(channel);
                console.log(`✅ Successfully auto-reconnected to #${channel.name}!`);
              }
            } catch (err) {
              console.error(`Auto-reconnect to #${channel.name} failed:`, err.message);
            }
          }, 3_000);
        } else {
          this.disconnect(guildId, true);
        }
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!guildState.explicitDisconnect) {
        console.log(`⚠️ Voice connection destroyed unexpectedly in #${channel.name}. Auto-rejoining in 3 seconds...`);
        this.guilds.delete(guildId);
        setTimeout(async () => {
          try {
            if (!guildState.explicitDisconnect && !this.isConnected(guildId)) {
              await this.join(channel);
              console.log(`✅ Successfully auto-rejoined #${channel.name}!`);
            }
          } catch (err) {
            console.error(`Auto-rejoin #${channel.name} failed:`, err.message);
          }
        }, 3_000);
      } else {
        this.disconnect(guildId, true);
      }
    });

    return guildState;
  }

  /**
   * Disconnects from the voice channel in a guild and cleans up all audio streams.
   * @param {string} guildId
   * @param {boolean} [isExplicit=false] - Whether this was initiated by /disconnect command
   */
  disconnect(guildId, isExplicit = false) {
    const guildState = this.guilds.get(guildId);
    if (guildState) {
      if (isExplicit) {
        guildState.explicitDisconnect = true;
        this.clearSavedChannel(guildId);
      }
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

    if (isExplicit) {
      this.clearSavedChannel(guildId);
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
   * Pushes an entire playlist of songs to the queue.
   * @param {string} guildId
   * @param {Array<object>} tracks
   * @returns {Promise<{ isPlayingNow: boolean, addedCount: number, firstTrack: object, queuePosition: number }>}
   */
  async playPlaylist(guildId, tracks) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) {
      throw new Error('Bot is not connected to a voice channel.');
    }

    if (!tracks || tracks.length === 0) {
      throw new Error('No tracks found in playlist.');
    }

    const initialQueueLength = guildState.queue.length;
    const isPlayingNow = !guildState.isPlaying;

    for (const track of tracks) {
      guildState.queue.push({
        type: 'song',
        ...track,
      });
    }

    if (isPlayingNow) {
      await this.playNext(guildId);
      return {
        isPlayingNow: true,
        addedCount: tracks.length,
        firstTrack: tracks[0],
        queuePosition: 0,
      };
    } else {
      return {
        isPlayingNow: false,
        addedCount: tracks.length,
        firstTrack: tracks[0],
        queuePosition: initialQueueLength + 1,
      };
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
          mixer.endSpeech();
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
        // Resolve stream on-demand if missing (e.g. queued from a playlist)
        if (!currentItem.streamUrl) {
          if (this.musicService && currentItem.track) {
            try {
              currentItem.streamUrl = await this.musicService.extractStream(currentItem.track);
            } catch (err) {
              console.error(
                `⚠️ Could not stream track "${currentItem.title}" by ${currentItem.author}: ${err.message}. Skipping to next track.`
              );
              return this.playNext(guildId);
            }
          } else {
            console.error(`⚠️ Track "${currentItem.title}" is missing streamUrl and resolver. Skipping.`);
            return this.playNext(guildId);
          }
        }

        // Create DuckingMixer to allow real-time background voice ducking with configured volume
        const mixer = new DuckingMixer(guildState.volume ?? 0.20, 0.40);
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
        resource.volume?.setVolume(0.40);
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
    const s = this.guilds.get(guildId);
    if (!s || !s.connection) return false;
    const st = s.connection.state.status;
    return (
      st === VoiceConnectionStatus.Ready ||
      st === VoiceConnectionStatus.Connecting ||
      st === VoiceConnectionStatus.Signalling
    );
  }

  /**
   * Gets current state for guild.
   * @param {string} guildId
   */
  getState(guildId) {
    return this.guilds.get(guildId);
  }

  /**
   * Sets playback volume for a guild (0.01 to 1.0).
   * @param {string} guildId
   * @param {number} volume - Float between 0.01 and 1.0
   * @returns {number} The updated volume percentage (1 to 100)
   */
  setVolume(guildId, volume) {
    const guildState = this.guilds.get(guildId);
    if (!guildState) {
      throw new Error('Bot is not connected to a voice channel.');
    }

    const clamped = Math.max(0.01, Math.min(1.0, volume));
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
   * @returns {number} Percentage (1 to 100)
   */
  getVolume(guildId) {
    const guildState = this.guilds.get(guildId);
    return Math.round((guildState?.volume ?? 0.20) * 100);
  }
}

module.exports = {
  VoiceManager,
};
