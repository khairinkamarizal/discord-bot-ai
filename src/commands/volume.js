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
          { name: '🎵 Music (Songs & 24/7 Radio)', value: 'music' },
          { name: '🗣️ Voice & Speech (/say, /ask, Entrances)', value: 'voice' },
          { name: '🔊 All / Master (Both Music & Voice)', value: 'all' }
        )
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
    const channel = interaction.options.getString('channel') || 'all';

    // If level is not specified, show current volume status dashboard
    if (level === null) {
      const vols = voiceManager.getVolumes(interaction.guildId);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🔊 Current Audio Volume Levels')
        .addFields(
          { name: '🎵 Music Volume', value: `**${vols.music}%**`, inline: true },
          { name: '🗣️ Voice & Speech Volume', value: `**${vols.voice}%**`, inline: true }
        )
        .setFooter({
          text: 'To adjust, run: /volume level: <1-100> [channel: Music / Voice / All]',
        })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // Set new volume for selected channel or both
    const updated = voiceManager.setVolume(interaction.guildId, level / 100, channel);

    let channelLabel = '🔊 All / Master (Music & Voice)';
    if (channel === 'music') channelLabel = '🎵 Music (Songs & Radio)';
    else if (channel === 'voice') channelLabel = '🗣️ Voice & Speech (/say, /ask, Entrances)';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🔊 Volume Adjusted: ${channelLabel}`)
      .setDescription(`Target level set to **${level}%**.`)
      .addFields(
        { name: '🎵 Music Volume', value: `**${updated.music}%**`, inline: true },
        { name: '🗣️ Voice & Speech Volume', value: `**${updated.voice}%**`, inline: true }
      )
      .setFooter({ text: 'Changes apply in real-time to active and upcoming playback' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
