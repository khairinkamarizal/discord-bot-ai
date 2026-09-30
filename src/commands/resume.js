const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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
        content: 'Playback is not currently paused.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'KH.AI STUDIO' })
      .setTitle('PLAYBACK RESUMED')
      .setDescription('Audio playback resumed.')
      .setFooter({ text: 'kh.ai studio' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
