const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('imagine')
    .setDescription('Generate an image using AI')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Describe the image you want to create')
        .setRequired(true)
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ aiService: import('../services/ai').AIService }} services
   */
  async execute(interaction, { aiService }) {
    const prompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
      const { buffer, text } = await aiService.generateImage(prompt);
      const attachment = new AttachmentBuilder(buffer, { name: 'imagine.png' });

      const embed = new EmbedBuilder()
        .setColor(0x1a1a1a)
        .setAuthor({ name: 'KH.AI STUDIO' })
        .setDescription(`"${prompt}"`)
        .setImage('attachment://imagine.png')
        .setFooter({ text: 'kh.ai studio' })
        .setTimestamp();

      if (text && text.length > 0 && !text.toLowerCase().includes("here's that image")) {
        embed.addFields({ name: 'Notes', value: text });
      }

      return await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    } catch (error) {
      console.error('Image generation error:', error);
      return await interaction.editReply({
        content: 'Unable to generate image. Please refine your prompt and try again.',
      });
    }
  },
};
