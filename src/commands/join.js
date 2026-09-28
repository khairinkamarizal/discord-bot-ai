const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel and stay connected until /disconnect'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const channel = interaction.member?.voice?.channel;

    if (!channel) {
      return interaction.reply({
        content: '❌ You need to be in a voice channel first for me to join you!',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // Check channel permissions
    const permissions = channel.permissionsFor(interaction.client.user);
    if (permissions && !permissions.has(PermissionFlagsBits.Connect)) {
      return interaction.editReply({
        content: '❌ I do not have permission to **Connect** to this voice channel! Please check the channel/role permissions.',
      });
    }
    if (permissions && !permissions.has(PermissionFlagsBits.Speak)) {
      return interaction.editReply({
        content: '❌ I do not have permission to **Speak** in this voice channel! Please check the channel/role permissions.',
      });
    }

    try {
      const state = await voiceManager.join(channel);
      return interaction.editReply({
        content: `🔊 Joined **#${state.channelName}**! I will remain here until someone types \`/disconnect\`.`,
      });
    } catch (error) {
      console.error('Failed to join voice channel:', error);
      return interaction.editReply({
        content: `❌ Failed to connect to the voice channel: ${error.message || 'Connection timed out'}. Please make sure the bot has Connect and Speak permissions.`,
      });
    }
  },
};
