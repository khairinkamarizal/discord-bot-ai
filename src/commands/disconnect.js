const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from the voice channel'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    await interaction.deferReply();

    const disconnected = voiceManager.disconnect(interaction.guildId, true);

    if (!disconnected) {
      return interaction.editReply({
        content: 'I am not currently connected to any voice channel in this server.',
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'KH.AI STUDIO' })
      .setTitle('VOICE DISCONNECT')
      .setDescription('Disconnected from the voice channel and released session.')
      .setFooter({ text: 'kh.ai studio' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
