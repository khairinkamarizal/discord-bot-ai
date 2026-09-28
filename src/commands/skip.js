const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the currently playing song or speech to the next in queue'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const skipped = voiceManager.skip(interaction.guildId);

    if (!skipped) {
      return interaction.reply({
        content: '❌ Nothing is currently playing to skip.',
        ephemeral: true,
      });
    }

    const title = skipped.title || (skipped.type === 'tts' ? 'AI Voice Response' : 'Current track');
    return interaction.reply({
      content: `⏭️ Skipped: **${title}**`,
    });
  },
};
