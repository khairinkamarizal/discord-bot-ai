const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cleanTextForSpeech } = require('../services/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make kh.AI speak whatever text you want out loud in the voice channel')
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('What should kh.AI say out loud?')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('voice')
        .setDescription('Optional: Choose speaker persona')
        .setRequired(false)
        .addChoices(
          { name: 'Auto (Malay: WaveNet / English: Studio)', value: 'auto' },
          { name: 'English (Male - Studio-Q)', value: 'guy' },
          { name: 'English (Female - Studio-O)', value: 'jenny' },
          { name: 'Malay (Male - WaveNet)', value: 'osman' },
          { name: 'Malay (Female - WaveNet)', value: 'yasmin' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const rawText = interaction.options.getString('text');
    const requestedVoice = interaction.options.getString('voice');

    // Defer reply immediately
    await interaction.deferReply();

    // Check voice connection status
    let isConnected = voiceManager.isConnected(interaction.guildId);

    // If bot is not connected, try to auto-join the user's voice channel
    if (!isConnected) {
      const userChannel = interaction.member?.voice?.channel;
      if (userChannel) {
        try {
          await voiceManager.join(userChannel);
          isConnected = true;
        } catch (err) {
          console.error('Auto-join voice channel failed in /say:', err);
        }
      }
    }

    if (!isConnected) {
      return interaction.editReply({
        content:
          'Not connected to a voice channel. Please join a voice channel and run `/join` first, or be inside a voice channel when using `/say`.',
      });
    }

    const cleanText = cleanTextForSpeech(rawText);

    if (!cleanText) {
      return interaction.editReply({
        content: 'Please provide valid text for speech.',
      });
    }

    try {
      const isFounder =
        ['398058083496230935', '443621655630053376'].includes(interaction.user.id) ||
        interaction.guild?.ownerId === interaction.user.id;
      const userName = isFounder
        ? 'Khai (Founder)'
        : (interaction.member?.displayName || interaction.user.username);

      // Resolve voice (Auto-detects Malay keywords or defaults to English Studio-Q)
      const selectedVoice = voiceManager.ttsService.resolveVoice(
        null,
        cleanText,
        requestedVoice === 'auto' ? null : requestedVoice
      );

      const guildState = voiceManager.getState(interaction.guildId);
      const channelName = guildState?.channelName || 'voice';

      // Queue or immediately speak text in voice channel
      const speakResult = await voiceManager.speak(interaction.guildId, cleanText, {
        text: cleanText,
        userName,
        voice: selectedVoice,
      });

      // Friendly label for the voice
      let voiceLabel = selectedVoice;
      if (selectedVoice.includes('Studio-Q') || selectedVoice.includes('Guy')) voiceLabel = 'English (Studio-Q - Studio HD)';
      else if (selectedVoice.includes('Studio-O') || selectedVoice.includes('Jenny')) voiceLabel = 'English (Studio-O - Studio HD)';
      else if (selectedVoice.includes('Wavenet-B') || selectedVoice.includes('Osman')) voiceLabel = 'Malay (WaveNet-B - Male HD)';
      else if (selectedVoice.includes('Wavenet-A') || selectedVoice.includes('Yasmin')) voiceLabel = 'Malay (WaveNet-A - Female HD)';

      const isMusicPlaying = guildState?.currentTrack?.type === 'song';
      const isSpeakingNow = speakResult?.isSpeakingNow;
      const queuePos = speakResult?.queuePosition || 1;

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'KH.AI STUDIO' })
        .setTitle(isSpeakingNow ? 'VOCAL SYNTHESIS' : 'VOCAL SYNTHESIS QUEUED')
        .addFields(
          { name: 'SPEAKER', value: `<@${interaction.user.id}>`, inline: true },
          {
            name: 'STATUS',
            value: isSpeakingNow ? 'Active' : `Queued (#${queuePos})`,
            inline: true,
          },
          { name: 'TRANSCRIPT', value: cleanText.slice(0, 1024) }
        )
        .setFooter({
          text: `#${channelName} • ${voiceLabel}${isMusicPlaying ? ' • ducked' : ''} • kh.ai studio`,
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /say:', error);
      return interaction.editReply({
        content: `An error occurred while speaking: ${error.message || 'Unknown error'}`,
      });
    }
  },
};
