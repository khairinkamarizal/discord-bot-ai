const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roastmode')
    .setDescription('Toggle auto-roasting when members join the voice channel')
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Turn auto-roast ON or OFF')
        .setRequired(true)
        .addChoices(
          { name: 'ON (Active entrance greetings)', value: 'on' },
          { name: 'OFF (Quiet mode)', value: 'off' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const status = interaction.options.getString('status') === 'on';
    voiceManager.setRoastMode(status);

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'kh.AI System' })
      .setTitle('ROAST MODE')
      .setDescription(
        status
          ? 'Entrance greetings enabled. Ambient welcoming active.'
          : 'Quiet mode active. Entrance greetings disabled.'
      )
      .setFooter({ text: 'kh.ai system' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
