const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Toggle real-time bidirectional voice conversation with Gemini Live')
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('Select action: on, off, status, or toggle')
        .setRequired(false)
        .addChoices(
          { name: 'Toggle (Switch ON / OFF)', value: 'toggle' },
          { name: 'ON (Start Gemini Live)', value: 'on' },
          { name: 'OFF (Stop Gemini Live)', value: 'off' },
          { name: 'Status (Inspect current session)', value: 'status' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager, liveVoiceService: import('../services/liveVoice').LiveVoiceService }} services
   */
  async execute(interaction, { voiceManager, liveVoiceService }) {
    await interaction.deferReply();

    const action = interaction.options.getString('action') || 'toggle';
    const memberVoiceChannel = interaction.member?.voice?.channel;

    if (action !== 'status' && action !== 'off' && !memberVoiceChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Live' })
        .setTitle('VOICE CHANNEL REQUIRED')
        .setDescription('Connect to a voice channel prior to initiating a Gemini Live session.')
        .setFooter({ text: 'kh.ai audio engine' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    try {
      const reply = await interaction.fetchReply().catch(() => null);
      const result = await liveVoiceService.toggleLive(
        interaction.guild,
        memberVoiceChannel,
        interaction.channel,
        action,
        reply
      );

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Live Engine' })
        .setFooter({ text: 'kh.ai audio engine' })
        .setTimestamp();

      if (result.action === 'started') {
        const hudEmbed = liveVoiceService.renderHudEmbed(result.liveState);
        return interaction.editReply({ embeds: [hudEmbed] });
      } else if (result.action === 'stopped') {
        embed
          .setTitle('GEMINI LIVE DEACTIVATED')
          .setDescription(
            'Live voice session concluded. Voice channel returned to standard idle standby.\n\n' +
            'Use `/live on` or `/live` to resume real-time voice streaming.'
          );
      } else if (result.action === 'already_on') {
        embed
          .setTitle('GEMINI LIVE ACTIVE')
          .setDescription(
            'Gemini Live session is already streaming in this voice channel.\n\n' +
            'Use `/live off` to deactivate or converse directly via microphone.'
          );
      } else if (result.action === 'already_off') {
        embed
          .setTitle('GEMINI LIVE INACTIVE')
          .setDescription(
            'Gemini Live is currently off (default standby).\n\n' +
            'Use `/live on` to activate real-time bidirectional voice streaming.'
          );
      } else if (result.action === 'status') {
        const info = result.info;
        if (info.isActive) {
          embed
            .setTitle('SESSION STATUS: ACTIVE')
            .setDescription(
              'Gemini Live bidirectional session is currently active.\n\n' +
              `• Model: ${info.model}\n` +
              `• Channel: <#${info.channelId}>\n` +
              `• Session Uptime: ${info.uptimeSec} seconds\n` +
              `• Inactive Duration: ${info.idleSec} seconds (Auto-standby at 120s)\n` +
              '• VAD: Active (transmitting speech only)'
            );
        } else {
          embed
            .setTitle('SESSION STATUS: STANDBY')
            .setDescription(
              'Gemini Live is inactive (default off).\n\n' +
              '• Status: Standby / Idle\n' +
              '• Tokens Consumed: 0 (No stream overhead)\n' +
              '• Activation: Use `/live on` or `/live toggle`'
            );
        }
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error executing /live:', err);

      const errorEmbed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Live' })
        .setTitle('LIVE ENGINE NOTICE')
        .setDescription(
          `Unable to complete Live session request: ${err.message}`
        )
        .setFooter({ text: 'kh.ai audio engine' })
        .setTimestamp();

      return interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
