const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset the AI conversation memory for this channel'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ aiService: import('../services/ai').AIService }} services
   */
  async execute(interaction, { aiService }) {
    const sessionId = interaction.channelId || interaction.guildId || 'default';
    const hadMemory = aiService.clearMemory(sessionId);

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'KH.AI STUDIO' })
      .setTitle('SESSION RESET')
      .setDescription(
        hadMemory
          ? 'Conversational memory cleared for this channel.'
          : 'No active conversational context to clear.'
      )
      .setFooter({ text: 'kh.ai studio' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
