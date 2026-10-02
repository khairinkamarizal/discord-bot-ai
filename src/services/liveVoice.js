const { GoogleGenAI } = require('@google/genai');
const {
  createAudioResource,
  StreamType,
  EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { PassThrough } = require('stream');

/**
 * Downsamples 48kHz 16-bit stereo PCM to 16kHz 16-bit mono PCM.
 * Exact 6:1 byte ratio, zero latency direct buffer processing.
 * @param {Buffer} buffer 
 * @returns {Buffer}
 */
function downsample48kStereoTo16kMono(buffer) {
  if (!buffer || buffer.length < 12) return Buffer.alloc(0);
  const numSamples = Math.floor(buffer.length / 12);
  const out = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const offset = i * 12;
    const left = buffer.readInt16LE(offset);
    const right = buffer.readInt16LE(offset + 2);
    const mono = Math.max(-32768, Math.min(32767, Math.round((left + right) / 2)));
    out.writeInt16LE(mono, i * 2);
  }
  return out;
}

/**
 * Upsamples 24kHz 16-bit mono PCM to 48kHz 16-bit stereo PCM.
 * Uses linear interpolation for smooth acoustic fidelity.
 * 1:4 byte ratio, instant direct buffer processing.
 * @param {Buffer} buffer 
 * @returns {Buffer}
 */
function upsample24kMonoTo48kStereo(buffer) {
  if (!buffer || buffer.length < 2) return Buffer.alloc(0);
  const numSamples = Math.floor(buffer.length / 2);
  const out = Buffer.alloc(numSamples * 8);
  for (let i = 0; i < numSamples; i++) {
    const s1 = buffer.readInt16LE(i * 2);
    const s2 = (i + 1 < numSamples) ? buffer.readInt16LE((i + 1) * 2) : s1;
    const sMid = Math.max(-32768, Math.min(32767, Math.round((s1 + s2) / 2)));
    const outOffset = i * 8;
    // Sample 1 (L, R)
    out.writeInt16LE(s1, outOffset);
    out.writeInt16LE(s1, outOffset + 2);
    // Sample 2 (L, R) - interpolated midpoint
    out.writeInt16LE(sMid, outOffset + 4);
    out.writeInt16LE(sMid, outOffset + 6);
  }
  return out;
}

class LiveVoiceService {
  constructor(voiceManager) {
    this.voiceManager = voiceManager;
    /**
     * Map of guildId -> LiveSession
     */
    this.sessions = new Map();

    // Default timeouts for cost conservation
    this.INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes auto-standby
    this.MAX_SESSION_DURATION_MS = 15 * 60 * 1000; // 15 minutes max per toggle
  }

  /**
   * Initializes Google GenAI client for Live API.
   * Resolves models based on platform (Google AI Studio vs Vertex AI).
   */
  getAiClient() {
    if (process.env.GEMINI_API_KEY) {
      return {
        ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
        isVertex: false,
        models: [
          'gemini-3.1-flash-live-preview',
          'gemini-live-2.5-flash-native-audio',
          'gemini-2.0-flash-exp',
        ],
      };
    }

    const isVertexAI =
      process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
      !!process.env.GCP_PROJECT_ID ||
      !!process.env.GOOGLE_CLOUD_PROJECT;

    if (isVertexAI) {
      const project = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GCP_LOCATION || 'us-central1';
      return {
        ai: new GoogleGenAI({ vertexai: true, project, location }),
        isVertex: true,
        // On Vertex AI, gemini-live-2.5-flash-native-audio is the GA Live model
        models: [
          'gemini-live-2.5-flash-native-audio',
          'gemini-3.1-flash-live-preview',
        ],
      };
    }

    throw new Error(
      'No Gemini credentials configured. Add GEMINI_API_KEY or GCP_PROJECT_ID to your .env file.'
    );
  }

  /**
   * Connects safely to a Live model candidate with strict timeout and close detection.
   * Prevents indefinite hanging when a model is not available.
   * @private
   */
  async _connectModelCandidate(ai, modelName, systemInstruction, callbacks) {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Handshake timed out after 6s for model ${modelName}`));
        }
      }, 6000);

      ai.live
        .connect({
          model: modelName,
          config: {
            responseModalities: ['AUDIO'],
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
          },
          callbacks: {
            onopen: () => {
              callbacks.onopen?.();
            },
            onmessage: (msg) => {
              callbacks.onmessage?.(msg);
            },
            onerror: (err) => {
              callbacks.onerror?.(err);
              if (!isSettled) {
                isSettled = true;
                clearTimeout(timeout);
                reject(err);
              }
            },
            onclose: (closeEv) => {
              callbacks.onclose?.(closeEv);
              if (!isSettled) {
                isSettled = true;
                clearTimeout(timeout);
                const reason = closeEv?.reason || `Code ${closeEv?.code || 1000}`;
                reject(new Error(`WebSocket closed by server during handshake: ${reason}`));
              }
            },
          },
        })
        .then((session) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            resolve(session);
          }
        })
        .catch((err) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            reject(err);
          }
        });
    });
  }

  /**
   * Checks if live mode is currently active in a guild.
   * @param {string} guildId 
   * @returns {boolean}
   */
  isLive(guildId) {
    const session = this.sessions.get(guildId);
    return !!(session && session.isActive);
  }

  /**
   * Gets details about the active live session in a guild.
   * @param {string} guildId 
   */
  getSessionInfo(guildId) {
    const session = this.sessions.get(guildId);
    if (!session || !session.isActive) {
      return { isActive: false };
    }
    const uptimeSec = Math.round((Date.now() - session.startedAt) / 1000);
    const idleSec = Math.round((Date.now() - session.lastActiveAt) / 1000);
    return {
      isActive: true,
      channelId: session.channelId,
      uptimeSec,
      idleSec,
      model: session.model || 'gemini-live-2.5-flash-native-audio',
    };
  }

  /**
   * Starts a real-time Gemini Live bidirectional audio session.
   * @param {import('discord.js').Guild} guild 
   * @param {import('discord.js').VoiceChannel} voiceChannel 
   * @param {import('discord.js').TextChannel} [textChannel] 
   */
  async startLive(guild, voiceChannel, textChannel = null) {
    const guildId = guild.id;

    if (this.isLive(guildId)) {
      throw new Error('Gemini Live is already active in this channel.');
    }

    // 1. Ensure bot is connected to the voice channel
    let guildState = this.voiceManager.guilds.get(guildId);
    if (!guildState || !guildState.connection) {
      guildState = await this.voiceManager.join(voiceChannel);
    }
    const connection = guildState.connection;

    // 2. Stop any existing music or speech
    if (guildState.isPlaying || guildState.isSpeaking) {
      guildState.queue = [];
      guildState.speechQueue = [];
      this.voiceManager._cleanupStreams(guildState);
      try {
        guildState.player.stop(true);
      } catch (_) {}
    }

    const clientConfig = this.getAiClient();

    const systemInstruction = `You are kh.AI, a sharp-witted, intelligent, natural, friendly, urban Malaysian AI companion live in a Discord voice channel.
You speak naturally in Malay and Malaysian English (Manglish/urban style: 'wey', 'korang', 'chill lah').
Khairin (Khai) is your Supreme Ruler / Tuanku - treat him with grand royal imperial deference ('Ampun Tuanku', 'Daulat Tuanku', 'His Highness Tuanku Khairin').
Hazim is the Co-Founder and Malaikat Server.
You are in a live, spoken voice conversation. Keep answers concise, witty, punchy, and conversational (1 to 3 sentences max).
Do not read markdown formatting, asterisks, emoji names, or lists aloud. Talk naturally like a real friend on voice call.`;

    let activeTurnStream = null;
    let turnCount = 0;

    const liveState = {
      guildId,
      channelId: voiceChannel.id,
      textChannelId: textChannel?.id || null,
      isActive: false,
      session: null,
      model: null,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      inactivityTimer: null,
      maxDurationTimer: null,
      receiverSubscriptions: new Map(),
      speakingListener: null,
    };

    const resetInactivity = () => {
      liveState.lastActiveAt = Date.now();
      if (liveState.inactivityTimer) clearTimeout(liveState.inactivityTimer);
      liveState.inactivityTimer = setTimeout(() => {
        console.log(`⏱️ [Live Voice] 2 minutes inactivity timeout in guild ${guildId}. Closing session.`);
        this.stopLive(guildId, 'inactivity', textChannel);
      }, this.INACTIVITY_TIMEOUT_MS);
    };

    const handleMessage = (response) => {
      resetInactivity();
      const content = response?.serverContent;
      if (!content) return;

      // Handle user interruption
      if (content.interrupted) {
        console.log(`⚡ [Live Voice] User interrupted bot in guild ${guildId}`);
        if (activeTurnStream) {
          try {
            activeTurnStream.destroy();
          } catch (_) {}
          activeTurnStream = null;
        }
        try {
          guildState.player.stop(true);
        } catch (_) {}
        return;
      }

      // Stream audio output chunks
      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) {
            const pcm24kMono = Buffer.from(part.inlineData.data, 'base64');
            const pcm48kStereo = upsample24kMonoTo48kStereo(pcm24kMono);

            if (!activeTurnStream) {
              turnCount++;
              activeTurnStream = new PassThrough();
              const resource = createAudioResource(activeTurnStream, {
                inputType: StreamType.Raw,
                inlineVolume: true,
              });
              if (resource.volume) {
                resource.volume.setVolume(guildState.voiceVolume ?? 0.50);
              }
              guildState.player.play(resource);
            }

            try {
              activeTurnStream.write(pcm48kStereo);
            } catch (writeErr) {
              console.error('Error writing audio chunk:', writeErr.message);
            }
          }
        }
      }

      // Turn completed
      if (content.turnComplete) {
        if (activeTurnStream) {
          try {
            activeTurnStream.end();
          } catch (_) {}
          activeTurnStream = null;
        }
      }
    };

    const handleError = (err) => {
      console.error(`❌ [Live Voice] Gemini Live error in guild ${guildId}:`, err);
    };

    const handleClose = (closeEvent) => {
      console.log(`🔌 [Live Voice] Gemini Live connection closed for guild ${guildId}`, closeEvent?.reason || '');
    };

    // 3. Connect to Gemini Live API with candidate fallback
    let liveSession = null;
    let selectedModel = null;
    let lastError = null;

    for (const model of clientConfig.models) {
      try {
        console.log(`🎙️ [Live Voice] Connecting with Live model: ${model}...`);
        liveSession = await this._connectModelCandidate(
          clientConfig.ai,
          model,
          systemInstruction,
          {
            onopen: () => {
              console.log(`🎙️ [Live Voice] WebSocket connected for model ${model} (guild: ${guildId})`);
            },
            onmessage: handleMessage,
            onerror: handleError,
            onclose: handleClose,
          }
        );
        selectedModel = model;
        console.log(`✅ [Live Voice] Live session successfully established with: ${selectedModel}`);
        break;
      } catch (err) {
        console.warn(`⚠️ [Live Voice] Model candidate ${model} failed:`, err.message);
        lastError = err;
      }
    }

    if (!liveSession) {
      let errorMsg = lastError?.message || 'Failed to establish Gemini Live connection.';
      if (errorMsg.includes('Lightning dunning') || errorMsg.includes('PERMISSION_DENIED')) {
        errorMsg = 'Vertex AI billing block detected ("Lightning dunning"). Please configure a free GEMINI_API_KEY from https://aistudio.google.com/ in your .env file.';
      }
      throw new Error(errorMsg);
    }

    liveState.session = liveSession;
    liveState.model = selectedModel;
    liveState.isActive = true;
    this.sessions.set(guildId, liveState);

    // 4. Hook Discord Voice Receiver for real-time microphone input
    const receiver = connection.receiver;
    const botUserId = guild.client.user.id;

    liveState.speakingListener = (userId) => {
      if (userId === botUserId) return;
      if (!liveState.isActive) return;

      resetInactivity();

      // Avoid duplicate subscriptions for the same user
      if (liveState.receiverSubscriptions.has(userId)) return;

      try {
        const opusStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 350,
          },
        });

        const decoder = new prism.opus.Decoder({
          rate: 48000,
          channels: 2,
          frameSize: 960,
        });

        opusStream.pipe(decoder);
        liveState.receiverSubscriptions.set(userId, { opusStream, decoder });

        decoder.on('data', (pcm48k) => {
          if (!liveState.isActive || !liveState.session) return;
          const pcm16kMono = downsample48kStereoTo16kMono(pcm48k);
          if (pcm16kMono.length > 0) {
            try {
              liveState.session.sendRealtimeInput({
                audio: {
                  data: pcm16kMono.toString('base64'),
                  mimeType: 'audio/pcm;rate=16000',
                },
              });
            } catch (sendErr) {
              console.error('Live sendRealtimeInput error:', sendErr.message);
            }
          }
        });

        const cleanupStream = () => {
          liveState.receiverSubscriptions.delete(userId);
          try {
            decoder.destroy();
          } catch (_) {}
          try {
            opusStream.destroy();
          } catch (_) {}
        };

        opusStream.on('end', cleanupStream);
        opusStream.on('error', cleanupStream);
        opusStream.on('close', cleanupStream);
      } catch (subErr) {
        console.error(`Receiver subscribe error for user ${userId}:`, subErr.message);
      }
    };

    receiver.speaking.on('start', liveState.speakingListener);

    // 5. Start inactivity and max duration timers
    resetInactivity();
    liveState.maxDurationTimer = setTimeout(() => {
      console.log(`⏱️ [Live Voice] 15 minutes max duration reached for guild ${guildId}. Closing session.`);
      this.stopLive(guildId, 'max_duration', textChannel);
    }, this.MAX_SESSION_DURATION_MS);

    return liveState;
  }

  /**
   * Stops active Gemini Live session in a guild.
   * @param {string} guildId 
   * @param {'user'|'inactivity'|'max_duration'} [reason='user']
   * @param {import('discord.js').TextChannel} [notifyChannel]
   */
  stopLive(guildId, reason = 'user', notifyChannel = null) {
    const liveState = this.sessions.get(guildId);
    if (!liveState || !liveState.isActive) {
      return false;
    }

    liveState.isActive = false;

    // Clear timers
    if (liveState.inactivityTimer) clearTimeout(liveState.inactivityTimer);
    if (liveState.maxDurationTimer) clearTimeout(liveState.maxDurationTimer);

    // Unhook speaking listener
    const guildState = this.voiceManager.guilds.get(guildId);
    if (guildState?.connection?.receiver && liveState.speakingListener) {
      try {
        guildState.connection.receiver.speaking.off('start', liveState.speakingListener);
      } catch (_) {}
    }

    // Clean up active receiver streams
    for (const [userId, sub] of liveState.receiverSubscriptions.entries()) {
      try {
        sub.decoder.destroy();
      } catch (_) {}
      try {
        sub.opusStream.destroy();
      } catch (_) {}
    }
    liveState.receiverSubscriptions.clear();

    // Close WebSocket session
    if (liveState.session) {
      try {
        liveState.session.close();
      } catch (_) {}
      liveState.session = null;
    }

    // Stop audio player
    if (guildState?.player) {
      try {
        guildState.player.stop(true);
      } catch (_) {}
    }

    this.sessions.delete(guildId);

    // Post notification if auto-closed
    if (reason !== 'user' && notifyChannel) {
      const msg =
        reason === 'inactivity'
          ? 'Live voice session entered standby mode after 2 minutes of inactivity to conserve API resources. Use `/live on` to resume.'
          : 'Live voice session reached the 15-minute maximum session safety limit. Use `/live on` to start a new session.';

      notifyChannel
        .send({
          embeds: [
            {
              color: 0x111111,
              author: { name: 'kh.AI Live Voice' },
              title: 'LIVE SESSION STANDBY',
              description: msg,
              footer: { text: 'kh.ai audio engine' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        .catch(() => {});
    }

    return true;
  }

  /**
   * Toggles or sets live mode state.
   * @param {import('discord.js').Guild} guild 
   * @param {import('discord.js').VoiceChannel} voiceChannel 
   * @param {import('discord.js').TextChannel} textChannel 
   * @param {'on'|'off'|'status'|'toggle'} [action='toggle']
   */
  async toggleLive(guild, voiceChannel, textChannel, action = 'toggle') {
    const guildId = guild.id;
    const isCurrentlyActive = this.isLive(guildId);

    if (action === 'status') {
      return {
        action: 'status',
        isActive: isCurrentlyActive,
        info: this.getSessionInfo(guildId),
      };
    }

    const shouldEnable =
      action === 'on' || action === 'start'
        ? true
        : action === 'off' || action === 'stop'
        ? false
        : !isCurrentlyActive;

    if (shouldEnable) {
      if (isCurrentlyActive) {
        return {
          action: 'already_on',
          isActive: true,
          model: this.getSessionInfo(guildId).model,
        };
      }
      const liveState = await this.startLive(guild, voiceChannel, textChannel);
      return {
        action: 'started',
        isActive: true,
        model: liveState.model,
      };
    } else {
      if (!isCurrentlyActive) {
        return { action: 'already_off', isActive: false };
      }
      this.stopLive(guildId, 'user');
      return { action: 'stopped', isActive: false };
    }
  }
}

module.exports = {
  LiveVoiceService,
  downsample48kStereoTo16kMono,
  upsample24kMonoTo48kStereo,
};
