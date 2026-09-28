const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume paused playback'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const resumed = voiceManager.resume(interaction.guildId);

    if (!resumed) {
      return interaction.reply({
        content: '❌ Playback is not paused.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: '▶️ Resumed playback.',
    });
  },
};
