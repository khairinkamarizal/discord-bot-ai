const { SlashCommandBuilder } = require('discord.js');

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
          { name: '🔥 ON (Auto-roast members & welcome Khai)', value: 'on' },
          { name: '🤫 OFF (Quiet mode, no entrance greetings)', value: 'off' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const status = interaction.options.getString('status') === 'on';
    voiceManager.setRoastMode(status);

    return interaction.reply({
      content: status
        ? '🔥 **Roast Mode is now ON!** kh.AI will greet Big Boss Khai with fanfare and savagely roast anyone else joining voice!'
        : '🤫 **Roast Mode is now OFF.** kh.AI will keep quiet when people join the voice channel.',
    });
  },
};
