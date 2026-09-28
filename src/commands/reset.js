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
      .setColor(hadMemory ? 0x57f287 : 0xfee75c)
      .setTitle('🧠 AI Conversation Memory Reset')
      .setDescription(
        hadMemory
          ? 'Memory cleared! kh.AI has forgotten prior topics in this channel and is ready for a fresh conversation.'
          : 'Memory is already empty for this channel.'
      )
      .setFooter({ text: 'kh.AI by Khairin' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
