const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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
        content: 'Nothing is currently playing or already paused.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'KH.AI STUDIO' })
      .setTitle('PLAYBACK PAUSED')
      .setDescription('Audio playback suspended. Use `/resume` to continue.')
      .setFooter({ text: 'kh.ai studio' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
