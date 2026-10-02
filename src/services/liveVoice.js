const { GoogleGenAI } = require('@google/genai');
const {
  createAudioResource,
  StreamType,
  EndBehaviorType,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
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

/**
 * Calculates the Root Mean Square (RMS) energy level of 16-bit PCM audio.
 * Used for noise gating to filter background room noise, hiss, fan, and breathing.
 * @param {Buffer} buffer
 * @returns {number}
 */
function calculateRms(buffer) {
  if (!buffer || buffer.length < 2) return 0;
  let sum = 0;
  const numSamples = Math.floor(buffer.length / 2);
  for (let i = 0; i < buffer.length; i += 2) {
    const val = buffer.readInt16LE(i);
    sum += val * val;
  }
  return Math.sqrt(sum / numSamples);
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
   * Enables input and output transcriptions for real-time subtitle feed.
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
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              activityHandling: 'NO_INTERRUPTION',
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
   * Renders the real-time HUD embed for an active Live session.
   * @param {object} liveState 
   */
  renderHudEmbed(liveState) {
    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'kh.AI Live Engine' })
      .setTitle('GEMINI LIVE ACTIVE')
      .setFooter({ text: 'kh.ai audio engine' })
      .setTimestamp();

    let stateBadge = 'LISTENING (Waiting for voice)';
    if (liveState.engineState === 'HEARING') {
      stateBadge = `HEARING (${liveState.currentSpeaker || 'User'} is speaking...)`;
    } else if (liveState.engineState === 'PROCESSING') {
      stateBadge = 'PROCESSING (Gemini is thinking...)';
    } else if (liveState.engineState === 'SPEAKING') {
      stateBadge = 'SPEAKING (Broadcasting voice response)';
    }

    let description =
      `Channel: <#${liveState.channelId}>\n` +
      `Engine State: **[${stateBadge}]**\n` +
      `Model: \`${liveState.model || 'gemini-live-2.5-flash-native-audio'}\`\n\n`;

    if (liveState.lastInputText) {
      description += `**Input:** ${liveState.lastInputText}\n`;
    }
    if (liveState.currentOutputText) {
      description += `**Speech:** "${liveState.currentOutputText}"\n`;
    }

    description +=
      '\n• Speak into your microphone naturally\n' +
      '• Auto-standby after 2 minutes of silence\n' +
      '• Use `/live off` to deactivate';

    embed.setDescription(description);
    return embed;
  }

  /**
   * Throttled updater for the HUD embed (maximum once per 1.2s to prevent rate limits).
   * @param {object} liveState 
   */
  scheduleHudUpdate(liveState) {
    if (!liveState.hudMessage) return;
    if (liveState.pendingHudTimer) return; // already queued

    const now = Date.now();
    const elapsed = now - (liveState.lastHudUpdate || 0);
    const delay = Math.max(0, 1200 - elapsed);

    liveState.pendingHudTimer = setTimeout(async () => {
      liveState.pendingHudTimer = null;
      liveState.lastHudUpdate = Date.now();
      try {
        const embed = this.renderHudEmbed(liveState);
        await liveState.hudMessage.edit({ embeds: [embed] }).catch(() => {});
      } catch (_) {}
    }, delay);
  }

  /**
   * Transitions engine state (LISTENING, HEARING, PROCESSING, SPEAKING) and updates presence/HUD.
   * @param {object} liveState 
   * @param {import('discord.js').Guild} guild 
   * @param {'LISTENING'|'HEARING'|'PROCESSING'|'SPEAKING'|'STANDBY'} newState 
   * @param {object} [meta={}] 
   */
  setEngineState(liveState, guild, newState, meta = {}) {
    if (!liveState.isActive && newState !== 'STANDBY') return;
    liveState.engineState = newState;

    if (meta.speaker) liveState.currentSpeaker = meta.speaker;
    if (meta.inputText !== undefined) liveState.lastInputText = meta.inputText;
    if (meta.outputText !== undefined) liveState.currentOutputText = meta.outputText;

    // Safety watchdog: prevent indefinite hang in PROCESSING state
    if (liveState.processingWatchdog) {
      clearTimeout(liveState.processingWatchdog);
      liveState.processingWatchdog = null;
    }
    if (newState === 'PROCESSING') {
      liveState.processingWatchdog = setTimeout(() => {
        if (liveState.isActive && liveState.engineState === 'PROCESSING') {
          console.warn(`⚠️ [Live Voice] Processing watchdog timeout (7s) in guild ${guild.id}. Resetting to LISTENING.`);
          this.setEngineState(liveState, guild, 'LISTENING');
        }
      }, 7000);
    }

    // Update bot Discord presence activity in member list
    try {
      const channelName = guild.channels.cache.get(liveState.channelId)?.name || 'voice';
      let activityName = `Listening in #${channelName}`;

      if (newState === 'HEARING') {
        activityName = `Hearing ${liveState.currentSpeaker || 'voice'}...`;
      } else if (newState === 'PROCESSING') {
        activityName = 'Thinking...';
      } else if (newState === 'SPEAKING') {
        activityName = `Speaking in #${channelName}`;
      } else if (newState === 'LISTENING') {
        activityName = `Listening in #${channelName}`;
      } else if (newState === 'STANDBY') {
        activityName = null;
      }

      if (activityName) {
        guild.client.user?.setActivity({
          name: activityName,
          type: 2, // Listening
        });
      } else {
        guild.client.user?.setActivity();
      }
    } catch (_) {}

    this.scheduleHudUpdate(liveState);
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
      engineState: session.engineState || 'LISTENING',
      currentSpeaker: session.currentSpeaker || null,
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
   * @param {import('discord.js').Message} [hudMessage]
   */
  async startLive(guild, voiceChannel, textChannel = null, hudMessage = null) {
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
      hudMessage: hudMessage || null,
      isActive: false,
      session: null,
      model: null,
      engineState: 'LISTENING',
      currentSpeaker: null,
      lastInputText: '',
      currentOutputText: '',
      lastHudUpdate: 0,
      pendingHudTimer: null,
      isBotSpeaking: false,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      inactivityTimer: null,
      maxDurationTimer: null,
      receiverSubscriptions: new Map(),
      activeSpeakers: new Set(),
      speakingListener: null,
      playerIdleListener: null,
      processingWatchdog: null,
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

      // Real-time input transcription
      if (content.inputTranscription?.text) {
        liveState.lastInputText = (liveState.lastInputText || '') + content.inputTranscription.text;
        this.scheduleHudUpdate(liveState);
      }

      // Real-time output transcription
      if (content.outputTranscription?.text) {
        liveState.currentOutputText = (liveState.currentOutputText || '') + content.outputTranscription.text;
        this.scheduleHudUpdate(liveState);
      }

      // Natural human speech: ignore server interruption events so the bot finishes speaking
      if (content.interrupted) {
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
              liveState.isBotSpeaking = true;
              activeTurnStream = new PassThrough();
              const resource = createAudioResource(activeTurnStream, {
                inputType: StreamType.Raw,
                inlineVolume: true,
              });
              if (resource.volume) {
                resource.volume.setVolume(guildState.voiceVolume ?? 0.50);
              }
              guildState.player.play(resource);

              // Update HUD state to SPEAKING
              this.setEngineState(liveState, guild, 'SPEAKING');
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
        // If player already idle (e.g. no audio in turn or playback already ended), reset state after room reverb delay
        if (guildState.player?.state?.status === AudioPlayerStatus.Idle) {
          setTimeout(() => {
            if (guildState?.player?.state?.status === AudioPlayerStatus.Idle) {
              liveState.isBotSpeaking = false;
              this.setEngineState(liveState, guild, 'LISTENING');
            }
          }, 150);
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

    // Listen for player returning to Idle when audio broadcast finishes
    if (guildState?.player) {
      const playerIdleListener = (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Idle) {
          liveState.isBotSpeaking = false;
          if (liveState.isActive && (liveState.engineState === 'SPEAKING' || liveState.engineState === 'PROCESSING')) {
            this.setEngineState(liveState, guild, 'LISTENING');
          }
        }
      };
      guildState.player.on('stateChange', playerIdleListener);
      liveState.playerIdleListener = playerIdleListener;
    }

    // Initial state: LISTENING
    this.setEngineState(liveState, guild, 'LISTENING');

    // 4. Hook Discord Voice Receiver for real-time microphone input
    const receiver = connection.receiver;
    const botUserId = guild.client.user.id;

    liveState.speakingListener = (userId) => {
      if (userId === botUserId) return;
      if (!liveState.isActive) return;

      resetInactivity();

      // Avoid duplicate subscriptions for the same user
      if (liveState.receiverSubscriptions.has(userId)) return;

      const member = guild.members.cache.get(userId);
      const speakerName = member?.displayName || 'User';

      try {
        const opusStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 450,
          },
        });

        const decoder = new prism.opus.Decoder({
          rate: 48000,
          channels: 2,
          frameSize: 960,
        });

        opusStream.pipe(decoder);
        liveState.receiverSubscriptions.set(userId, { opusStream, decoder });

        let isSpeaking = false;
        let turnVoicedFrames = 0;

        decoder.on('data', (pcm48k) => {
          if (!liveState.isActive || !liveState.session) return;

          // While bot is broadcasting audio, ignore microphone to avoid speaker bleed/echo
          if (liveState.isBotSpeaking) return;

          const rms = calculateRms(pcm48k);
          const voiceThreshold = 500;

          if (rms >= voiceThreshold) {
            turnVoicedFrames++;

            if (!isSpeaking) {
              isSpeaking = true;
              liveState.activeSpeakers.add(userId);

              if (liveState.engineState !== 'HEARING') {
                this.setEngineState(liveState, guild, 'HEARING', {
                  speaker: speakerName,
                  inputText: '',
                  outputText: '',
                });
              }
            }
          }

          if (isSpeaking) {
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
          }
        });

        const cleanupStream = () => {
          liveState.receiverSubscriptions.delete(userId);
          liveState.activeSpeakers.delete(userId);
          try {
            decoder.destroy();
          } catch (_) {}
          try {
            opusStream.destroy();
          } catch (_) {}

          // If speech was active (at least 3 voiced frames = 60ms) and no other user is talking:
          if (turnVoicedFrames >= 3 && liveState.activeSpeakers.size === 0) {
            turnVoicedFrames = 0;
            isSpeaking = false;
            try {
              liveState.session?.sendRealtimeInput({ audioStreamEnd: true });
              liveState.session?.sendClientContent({ turnComplete: true });
            } catch (err) {
              console.error('Live turnComplete error:', err.message);
            }
            this.setEngineState(liveState, guild, 'PROCESSING');
          } else if (liveState.activeSpeakers.size === 0 && liveState.engineState === 'HEARING') {
            this.setEngineState(liveState, guild, 'LISTENING');
          }
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
    if (liveState.pendingHudTimer) clearTimeout(liveState.pendingHudTimer);
    if (liveState.processingWatchdog) clearTimeout(liveState.processingWatchdog);

    // Unhook speaking and player listeners
    const guildState = this.voiceManager.guilds.get(guildId);
    if (guildState?.connection?.receiver && liveState.speakingListener) {
      try {
        guildState.connection.receiver.speaking.off('start', liveState.speakingListener);
      } catch (_) {}
    }
    if (guildState?.player && liveState.playerIdleListener) {
      try {
        guildState.player.off('stateChange', liveState.playerIdleListener);
      } catch (_) {}
      liveState.playerIdleListener = null;
    }
    liveState.activeSpeakers?.clear();

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

    // Reset bot presence activity
    try {
      guildState?.channel?.guild?.client?.user?.setActivity();
    } catch (_) {}

    // Update HUD embed one last time to show deactivated state
    if (liveState.hudMessage) {
      const deactEmbed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Live Engine' })
        .setTitle('GEMINI LIVE DEACTIVATED')
        .setDescription(
          reason === 'inactivity'
            ? 'Live session entered standby mode after 2 minutes of inactivity to conserve API resources.\n\nUse `/live on` to resume real-time voice streaming.'
            : reason === 'max_duration'
            ? 'Live session reached the 15-minute maximum session safety limit.\n\nUse `/live on` to resume.'
            : 'Live voice session concluded. Voice channel returned to standard idle standby.\n\nUse `/live on` to reactivate.'
        )
        .setFooter({ text: 'kh.ai audio engine' })
        .setTimestamp();

      liveState.hudMessage.edit({ embeds: [deactEmbed] }).catch(() => {});
    }

    this.sessions.delete(guildId);

    return true;
  }

  /**
   * Toggles or sets live mode state.
   * @param {import('discord.js').Guild} guild 
   * @param {import('discord.js').VoiceChannel} voiceChannel 
   * @param {import('discord.js').TextChannel} textChannel 
   * @param {'on'|'off'|'status'|'toggle'} [action='toggle']
   * @param {import('discord.js').Message} [hudMessage]
   */
  async toggleLive(guild, voiceChannel, textChannel, action = 'toggle', hudMessage = null) {
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
      const liveState = await this.startLive(guild, voiceChannel, textChannel, hudMessage);
      return {
        action: 'started',
        isActive: true,
        model: liveState.model,
        liveState,
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
  calculateRms,
};
