const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop current voice playback and clear the audio queue'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const stopped = voiceManager.stop(interaction.guildId);

    if (!stopped) {
      return interaction.reply({
        content: 'No audio is currently playing in this server.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'kh.AI Audio' })
      .setTitle('PLAYBACK TERMINATED')
      .setDescription('Stopped playback and cleared the audio queue.')
      .setFooter({ text: 'kh.ai audio' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
