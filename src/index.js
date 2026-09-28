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

  // Register slash commands automatically
  try {
    const guildId = process.env.GUILD_ID;
    if (guildId) {
      console.log(
        `⚡ Registering slash commands for testing guild ID: ${guildId}...`,
      );
      await readyClient.application.commands.set(slashCommandsData, guildId);
      console.log('✅ Guild slash commands registered instantly!');
    } else {
      console.log(
        '🌐 Registering global slash commands (may take a few minutes to cache across all servers)...',
      );
      await readyClient.application.commands.set(slashCommandsData);
      console.log('✅ Global slash commands registered successfully!');
    }
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

// Log in to Discord
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('❌ Failed to log in to Discord:', err);
  process.exit(1);
});
