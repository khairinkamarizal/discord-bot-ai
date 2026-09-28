const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('View or change the audio volume (music & AI voice)')
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Volume level from 5 to 100% (default is 50%)')
        .setMinValue(5)
        .setMaxValue(100)
        .setRequired(false)
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    if (!voiceManager.isConnected(interaction.guildId)) {
      return interaction.reply({
        content: '❌ I am not connected to a voice channel in this server.',
        ephemeral: true,
      });
    }

    const level = interaction.options.getInteger('level');

    if (level === null) {
      const current = voiceManager.getVolume(interaction.guildId);
      return interaction.reply({
        content: `🔊 Current playback volume is **${current}%**.`,
      });
    }

    const newVolume = voiceManager.setVolume(interaction.guildId, level / 100);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔊 Volume Adjusted')
      .setDescription(`Playback volume set to **${newVolume}%**.`)
      .setFooter({ text: 'Applies to music, background ducking, and AI voice responses' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
