const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Ask the AI assistant anything and it will respond out loud in your voice channel')
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('What do you want to ask?')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('voice')
        .setDescription('Optional: Choose speaker persona')
        .setRequired(false)
        .addChoices(
          { name: 'Auto (Malay: Yasmin / English: Guy)', value: 'auto' },
          { name: 'Malay (Yasmin - Female)', value: 'yasmin' },
          { name: 'Malay (Osman - Male)', value: 'osman' },
          { name: 'English (Guy - Male)', value: 'guy' },
          { name: 'English (Jenny - Female)', value: 'jenny' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager, aiService: import('../services/ai').AIService }} services
   */
  async execute(interaction, { voiceManager, aiService }) {
    const question = interaction.options.getString('question');
    const requestedVoice = interaction.options.getString('voice');

    // Defer reply immediately since AI generation + TTS takes 1-3 seconds
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
          console.error('Auto-join voice channel failed:', err);
        }
      }
    }

    if (!isConnected) {
      return interaction.editReply({
        content:
          '❌ I am not connected to a voice channel. Please join a voice channel and run `/join` first, or be inside a voice channel when using `/help`.',
      });
    }

    try {
      const userName = interaction.member?.displayName || interaction.user.username;

      const sessionId = interaction.channelId || interaction.guildId || 'default';

      // 1. Generate concise, voice-tailored answer from Gemini addressing the user with memory
      const { rawText, speechText, langCode, memoryTurns } = await aiService.askQuestion(
        question,
        userName,
        sessionId
      );

      // 2. Resolve language-specific neural voice (Malay: Yasmin / English: Guy)
      const selectedVoice = voiceManager.ttsService.resolveVoice(
        langCode,
        `${question} ${speechText}`,
        requestedVoice === 'auto' ? null : requestedVoice
      );

      // 3. Play or mix the audio in the voice channel (with ducking if music is active)
      const guildState = voiceManager.getState(interaction.guildId);
      const channelName = guildState?.channelName || 'voice';

      await voiceManager.speak(interaction.guildId, speechText, {
        question,
        userName,
        voice: selectedVoice,
      });

      // 4. Friendly label for the voice
      let voiceLabel = selectedVoice;
      if (selectedVoice.includes('Yasmin')) voiceLabel = 'Malay (Yasmin - Female)';
      else if (selectedVoice.includes('Osman')) voiceLabel = 'Malay (Osman - Male)';
      else if (selectedVoice.includes('Guy')) voiceLabel = 'English (Guy - Male)';
      else if (selectedVoice.includes('Jenny')) voiceLabel = 'English (Jenny - Female)';

      // 5. Display the response embed in text chat
      const isMusicPlaying = guildState?.currentTrack?.type === 'song';
      const memoryStatus = memoryTurns > 1 ? ` • 🧠 ${memoryTurns} turns` : '';
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎙️ Voice AI Answer')
        .addFields(
          { name: '👤 User', value: `<@${interaction.user.id}>`, inline: true },
          { name: '❓ Question', value: question.slice(0, 1024) },
          { name: '💬 Spoken Answer', value: rawText.slice(0, 1024) }
        )
        .setFooter({
          text: `🔊 #${channelName} • Voice: ${voiceLabel}${isMusicPlaying ? ' • Music ducked' : ''}${memoryStatus} • kh.AI by Khairin`,
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /help question:', error);
      return interaction.editReply({
        content: `❌ An error occurred while generating the answer: ${error.message || 'Unknown error'}`,
      });
    }
  },
};
