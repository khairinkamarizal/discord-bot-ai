const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current playback'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const paused = voiceManager.pause(interaction.guildId);

    if (!paused) {
      return interaction.reply({
        content: '❌ Nothing is currently playing or already paused.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: '⏸️ Paused playback. Use `/resume` to continue.',
    });
  },
};
