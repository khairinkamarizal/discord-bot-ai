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
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager, aiService: import('../services/ai').AIService }} services
   */
  async execute(interaction, { voiceManager, aiService }) {
    const question = interaction.options.getString('question');

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

      // 1. Generate concise, voice-tailored answer from Gemini addressing the user
      const { rawText, speechText, langCode } = await aiService.askQuestion(question, userName);

      // 2. Resolve language-specific neural voice (e.g. Malay Yasmin, Indonesian Gadis, etc.)
      const selectedVoice = voiceManager.ttsService.resolveVoice(
        langCode,
        `${question} ${speechText}`
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
      if (selectedVoice.includes('Yasmin')) voiceLabel = 'Malay (Yasmin)';
      else if (selectedVoice.includes('Osman')) voiceLabel = 'Malay (Osman)';
      else if (selectedVoice.includes('Gadis')) voiceLabel = 'Indonesian (Gadis)';
      else if (selectedVoice.includes('Jenny')) voiceLabel = 'English (Jenny)';
      else if (selectedVoice.includes('Nanami')) voiceLabel = 'Japanese (Nanami)';
      else if (selectedVoice.includes('Xiaoxiao')) voiceLabel = 'Chinese (Xiaoxiao)';

      // 5. Display the response embed in text chat
      const isMusicPlaying = guildState?.currentTrack?.type === 'song';
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎙️ Voice AI Answer')
        .addFields(
          { name: '👤 User', value: `<@${interaction.user.id}>`, inline: true },
          { name: '❓ Question', value: question.slice(0, 1024) },
          { name: '💬 Spoken Answer', value: rawText.slice(0, 1024) }
        )
        .setFooter({
          text: `🔊 #${channelName} • Voice: ${voiceLabel}${isMusicPlaying ? ' • Music ducked to 20%' : ''} • Powered by Gemini & Edge TTS`,
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
