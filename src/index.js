const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require('discord.js');

const prism = require('prism-media');

// Force prism-media to use system FFmpeg from PATH instead of bundled static binaries
// (static ffmpeg builds hang on HTTPS/HLS audio streams on Linux)
const systemFFmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
prism.FFmpeg.getInfo = () => ({
  command: systemFFmpeg,
  output: 'system ffmpeg',
  version: 'system',
});

const { VoiceManager } = require('./voice/player');
const { AIService } = require('./services/ai');
const { MusicService } = require('./services/music');

// Ensure token is provided
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Error: DISCORD_TOKEN is missing in your .env file!');
  process.exit(1);
}

// Initialize Discord client with message intents for @mention chatting
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Cooldown tracker for voice entrance roasts (userId -> timestamp)
const entranceCooldowns = new Map();

client.commands = new Collection();

// Initialize services
const voiceManager = new VoiceManager();
const aiService = new AIService();
const musicService = new MusicService(client);
voiceManager.setMusicService(musicService);

// Load commands from commands directory
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js'));

const slashCommandsData = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    slashCommandsData.push(command.data.toJSON());
  } else {
    console.warn(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
    );
  }
}

// Bot ready event
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`🤖 Logged in as ${readyClient.user.tag}!`);

  readyClient.user.setActivity('/help & /play | khair.ink', {
    type: ActivityType.Listening,
  });

  // Pre-initialize music extractors in background
  musicService.init().catch((err) => {
    console.error('Failed to pre-load music extractors:', err);
  });

  // Auto-restore persistent voice channels
  try {
    const savedChannels = voiceManager.getSavedChannels();
    for (const [guildId, channelId] of Object.entries(savedChannels)) {
      try {
        const guild = readyClient.guilds.cache.get(guildId);
        if (!guild) continue;
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.isVoiceBased()) {
          console.log(`🔄 [Auto-Restore] Rejoining voice channel "${channel.name}" in "${guild.name}"...`);
          await voiceManager.join(channel);
        }
      } catch (err) {
        console.warn(`Failed to auto-restore voice channel ${channelId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error during voice auto-restore:', err);
  }

  // Register slash commands automatically (Global sync, clear guild duplicates)
  try {
    // 1. Clear any guild-specific command registrations so Discord doesn't show duplicates
    for (const [id, guild] of readyClient.guilds.cache) {
      try {
        await guild.commands.set([]);
        console.log(`🧹 Cleaned guild-specific commands for ${guild.name} (${id})`);
      } catch (err) {
        console.warn(`Could not clear guild commands for ${guild.name}:`, err.message);
      }
    }

    // 2. Register clean global slash commands
    await readyClient.application.commands.set(slashCommandsData);
    console.log('✅ Global slash commands synced successfully (no duplicates)!');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error);
  }
});

// Handle slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction, {
      voiceManager,
      aiService,
      musicService,
    });
  } catch (error) {
    console.error(`Error executing /${interaction.commandName}:`, error);

    const errorMessage = {
      content: '❌ There was an error while executing this command!',
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage).catch(() => {});
    } else {
      await interaction.reply(errorMessage).catch(() => {});
    }
  }
});

// Handle voice state updates (channel moves, external drops, and entrance roaster/VIP)
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // CASE 1: The bot itself changed voice state
  if (newState.member?.id === client.user?.id) {
    // Bot was moved to another voice channel
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      console.log(`🔀 Bot moved to channel: ${newState.channel?.name}`);
      const guildState = voiceManager.guilds.get(newState.guild.id);
      if (guildState) {
        guildState.channelId = newState.channelId;
        guildState.channelName = newState.channel?.name || 'voice';
        guildState.channel = newState.channel;
        voiceManager.saveChannel(newState.guild.id, newState.channelId);
      }
    } else if (oldState.channelId && !newState.channelId) {
      // Bot was disconnected from voice externally (e.g. network glitch or kicked without /disconnect)
      const guildState = voiceManager.guilds.get(oldState.guild.id);
      if (guildState && !guildState.explicitDisconnect) {
        console.log(`⚠️ Bot disconnected externally from #${oldState.channel?.name}. Auto-rejoining in 3s...`);
        setTimeout(async () => {
          try {
            if (!guildState.explicitDisconnect && !voiceManager.isConnected(oldState.guild.id)) {
              const ch = oldState.guild.channels.cache.get(oldState.channelId);
              if (ch && ch.isVoiceBased()) {
                await voiceManager.join(ch);
                console.log(`✅ Successfully auto-rejoined #${ch.name}!`);
              }
            }
          } catch (err) {
            console.warn('Auto-rejoin on voiceStateUpdate failed:', err.message);
          }
        }, 3000);
      }
    }
    return;
  }

  // CASE 2: Other members joining the voice channel kh.AI is in (Auto-Bahan & Boss VIP Intro)
  if (!newState.member?.user?.bot && voiceManager.isRoastMode()) {
    const guildId = newState.guild.id;
    const guildState = voiceManager.guilds.get(guildId);
    const botChannelId = guildState?.channelId;

    if (botChannelId && newState.channelId === botChannelId && oldState.channelId !== botChannelId) {
      const userId = newState.member.id;
      const now = Date.now();
      const lastGreet = entranceCooldowns.get(userId) || 0;

      // 45 seconds cooldown per user to prevent rejoin spamming
      if (now - lastGreet > 45_000) {
        entranceCooldowns.set(userId, now);

        const isFounder =
          userId === '443621655630053376' ||
          newState.guild.ownerId === userId ||
          (newState.member.displayName && newState.member.displayName.toLowerCase().includes('khai'));

        if (isFounder) {
          console.log(`👑 [VIP Founder] Khai entered #${newState.channel?.name}!`);
          const soundPath = path.join(__dirname, '../assets/sounds/boss-intro.mp3');
          voiceManager.playSoundFile(guildId, soundPath).catch(() => {});

          setTimeout(async () => {
            try {
              const bossGreets = [
                'Perhatian semua dalam channel! The Founder, Developer, dan Big Boss kita Khairin dah masuk. Tabik hormat sikit!',
                'Haa big boss Khai dah sampai. Ada apa-apa arahan ke bos?',
                'All hail the founder! Khai is in the house. Welcome boss.',
              ];
              const greet = bossGreets[Math.floor(Math.random() * bossGreets.length)];
              await voiceManager.speak(guildId, greet, { voice: 'ms-MY-Wavenet-B' });
            } catch (e) {
              console.error('Founder greeting error:', e);
            }
          }, 1200);
        } else {
          const memberName = newState.member.displayName || newState.member.user.username;
          console.log(`😈 [Roast Member] ${memberName} entered #${newState.channel?.name}`);

          setTimeout(async () => {
            try {
              const roasts = [
                `Haa masuk pun kau ${memberName}, ingatkan dah kena culik dengan alien.`,
                `Aduh, siapa jemput ${memberName} masuk ni? Baru je aman damai tadi.`,
                `Eh ${memberName}, kau masuk-masuk ni dah mandi ke belum? Dari jauh dah bau hangit.`,
                `Tengok siapa yang baru masuk, orang paling tak ada life dalam server. Welcome ${memberName}.`,
                `Masuk pun kau ${memberName}. Ingat eh, jangan sembang merapu malam ni.`,
                `Haa ${memberName} dah sampai. Korang sorok barang berharga cepat.`,
                `Well well well, look who decided to show up. Welcome ${memberName}, try not to embarrass yourself today.`,
              ];
              const roastText = roasts[Math.floor(Math.random() * roasts.length)];
              await voiceManager.speak(guildId, roastText, { voice: 'ms-MY-Wavenet-B' });
            } catch (e) {
              console.error('Member roast error:', e);
            }
          }, 800);
        }
      }
    }
  }
});

// Handle text chat mentions (@kh.AI <message>)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user.id) || message.mentions.everyone) return;

  const cleanPrompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();

  if (!cleanPrompt) {
    const responses = [
      'Oi, tag-tag aku kenapa? Rindu ke?',
      'Haa apa hal panggil aku? Nak suruh belanja makan ke?',
      'Tag aku tapi tak cakap apa-apa, otak letak kat mana bro?',
      'Ada apa sebut-sebut nama aku ni? Sembang biar ada isi sikit.',
      'Yes, who summoned the one and only kh.AI? Speak up.',
    ];
    const replyText = responses[Math.floor(Math.random() * responses.length)];
    return message.reply(replyText).catch(() => {});
  }

  try {
    await message.channel.sendTyping();
  } catch (_) {}

  try {
    const userName = message.member?.displayName || message.author.username;
    const sessionId = message.channelId;

    const { rawText } = await aiService.askQuestion(cleanPrompt, userName, sessionId);

    await message.reply(rawText);
  } catch (error) {
    console.error('Error handling @mention chat:', error);
    await message.reply('Aduh, pening kepala aku layan soalan kau ni. Cuba tanya benda berakal sikit.').catch(() => {});
  }
});

// Graceful shutdown handling
const handleShutdown = async (signal) => {
  console.log(
    `\n🛑 Received ${signal}. Disconnecting voice clients and shutting down...`,
  );
  try {
    for (const [guildId] of voiceManager.guilds) {
      voiceManager.disconnect(guildId);
    }
    client.destroy();
  } catch (e) {
    // Ignore cleanup errors
  }
  process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Global anti-crash handlers to prevent transient errors from killing the process
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Anti-Crash] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err, origin) => {
  console.error(`⚠️ [Anti-Crash] Uncaught Exception (${origin}):`, err);
});

// Log in to Discord
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('❌ Failed to log in to Discord:', err);
  process.exit(1);
});
