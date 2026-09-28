const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from the voice channel'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../voice/player').VoiceManager} voiceManager
   */
  async execute(interaction, { voiceManager }) {
    const disconnected = voiceManager.disconnect(interaction.guildId);

    if (!disconnected) {
      return interaction.reply({
        content: '❌ I am not currently connected to any voice channel in this server.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: '👋 Disconnected from the voice channel. See you next time!',
    });
  },
};
