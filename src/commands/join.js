const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel and stay connected until /disconnect'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../voice/player').VoiceManager} voiceManager
   */
  async execute(interaction, { voiceManager }) {
    const channel = interaction.member?.voice?.channel;

    if (!channel) {
      return interaction.reply({
        content: '❌ You need to be in a voice channel first for me to join you!',
        ephemeral: true,
      });
    }

    try {
      await interaction.deferReply();
      const state = await voiceManager.join(channel);
      return interaction.editReply({
        content: `🔊 Joined **#${state.channelName}**! I will remain here until someone types \`/disconnect\`.`,
      });
    } catch (error) {
      console.error('Failed to join voice channel:', error);
      return interaction.editReply({
        content: '❌ Failed to connect to the voice channel. Make sure I have permissions to join and speak in that channel.',
      });
    }
  },
};
