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

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

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

// Handle voice state updates (channel moves, external drops, etc.)
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (newState.member?.id !== client.user?.id) return;

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
