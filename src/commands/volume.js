const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('View or change volume for music, voice/speech, or all audio')
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Volume level from 1 to 100%')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('channel')
        .setDescription('Which audio channel to adjust (default: All / Master)')
        .setRequired(false)
        .addChoices(
          { name: 'Music (Songs & Radio)', value: 'music' },
          { name: 'Voice (Speech & Dialogue)', value: 'voice' },
          { name: 'All / Master Output', value: 'all' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    if (!voiceManager.isConnected(interaction.guildId)) {
      return interaction.reply({
        content: 'I am not connected to a voice channel in this server.',
        ephemeral: true,
      });
    }

    const level = interaction.options.getInteger('level');
    const channel = interaction.options.getString('channel') || 'all';

    // If level is not specified, show current volume status dashboard
    if (level === null) {
      const vols = voiceManager.getVolumes(interaction.guildId);
      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Audio' })
        .setTitle('AUDIO LEVELS')
        .addFields(
          { name: 'MUSIC', value: `${vols.music}%`, inline: true },
          { name: 'VOICE', value: `${vols.voice}%`, inline: true }
        )
        .setFooter({
          text: 'Use /volume level: <1-100> [channel] • kh.ai audio',
        })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // Set new volume for selected channel or both
    const updated = voiceManager.setVolume(interaction.guildId, level / 100, channel);

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'kh.AI Audio' })
      .setTitle('LEVEL ADJUSTED')
      .setDescription(`Channel **${channel.toUpperCase()}** set to **${level}%**.`)
      .addFields(
        { name: 'MUSIC', value: `${updated.music}%`, inline: true },
        { name: 'VOICE', value: `${updated.voice}%`, inline: true }
      )
      .setFooter({ text: 'Real-time output adjustment • kh.ai audio' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
