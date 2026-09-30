const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('imagine')
    .setDescription('Generate or transform an image using AI')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Describe what you want to create or how to modify the reference')
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option
        .setName('reference')
        .setDescription('Optional image to use as visual reference or style source')
        .setRequired(false)
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ aiService: import('../services/ai').AIService }} services
   */
  async execute(interaction, { aiService }) {
    const prompt = interaction.options.getString('prompt');
    const referenceAttachment = interaction.options.getAttachment('reference');

    await interaction.deferReply();

    try {
      let referenceImage = null;
      if (referenceAttachment) {
        const contentType = referenceAttachment.contentType || '';
        if (contentType && !contentType.startsWith('image/')) {
          return await interaction.editReply({
            content: 'The attached reference must be a valid image file (PNG, JPEG, WEBP).',
          });
        }

        const res = await fetch(referenceAttachment.url);
        if (!res.ok) {
          throw new Error('Failed to retrieve reference image.');
        }
        const arrayBuffer = await res.arrayBuffer();
        referenceImage = {
          buffer: Buffer.from(arrayBuffer),
          mimeType: contentType || 'image/png',
        };
      }

      const { buffer, text } = await aiService.generateImage(prompt, referenceImage);
      const attachment = new AttachmentBuilder(buffer, { name: 'imagine.png' });

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'KH.AI STUDIO' })
        .setTitle('VISUAL SYNTHESIS')
        .setDescription(`"${prompt}"`)
        .setImage('attachment://imagine.png')
        .setFooter({ text: 'kh.ai studio' })
        .setTimestamp();

      if (referenceAttachment) {
        embed.addFields({
          name: 'MODE',
          value: 'Image-to-Image (Reference Guided)',
          inline: true,
        });
      }

      if (text && text.length > 0 && !text.toLowerCase().includes("here's that image")) {
        embed.addFields({ name: 'NOTES', value: text, inline: !referenceAttachment });
      }

      return await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    } catch (error) {
      console.error('Image generation error:', error);
      return await interaction.editReply({
        content: `Unable to generate image: ${error.message || 'Please refine your prompt and try again.'}`,
      });
    }
  },
};
