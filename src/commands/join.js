const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

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
        content: 'You need to be in a voice channel first for me to join you.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // Check channel permissions
    const permissions = channel.permissionsFor(interaction.client.user);
    if (permissions && !permissions.has(PermissionFlagsBits.Connect)) {
      return interaction.editReply({
        content: 'I do not have permission to Connect to this voice channel. Please check channel permissions.',
      });
    }
    if (permissions && !permissions.has(PermissionFlagsBits.Speak)) {
      return interaction.editReply({
        content: 'I do not have permission to Speak in this voice channel. Please check channel permissions.',
      });
    }

    try {
      const state = await voiceManager.join(channel);
      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'KH.AI STUDIO' })
        .setTitle('VOICE CONNECTION')
        .setDescription(`Connected to **#${state.channelName}**. Session remains active until \`/disconnect\`.`)
        .setFooter({ text: 'kh.ai studio' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to join voice channel:', error);
      return interaction.editReply({
        content: `Failed to connect to the voice channel: ${error.message || 'Connection timed out'}.`,
      });
    }
  },
};
