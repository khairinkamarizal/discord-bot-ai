const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask kh.AI anything and it will respond out loud in your voice channel')
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
          { name: 'Auto (Chirp 3 HD Generative Foundation)', value: 'auto' },
          { name: 'Puck (Chirp 3 HD - Upbeat & Expressive)', value: 'puck' },
          { name: 'Zuben (Chirp 3 HD - Chill Casual Urban)', value: 'zuben' },
          { name: 'Fenrir (Chirp 3 HD - Energetic)', value: 'fenrir' },
          { name: 'Despina (Chirp 3 HD - Smooth Female)', value: 'despina' },
          { name: 'Malay / Regional (Chirp 3 HD)', value: 'puck_my' },
          { name: 'Malay (Legacy WaveNet-B)', value: 'osman' }
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
          'Not connected to a voice channel. Please join a voice channel and run `/join` first, or be inside a voice channel when using `/ask`.',
      });
    }

    try {
      const isFounder =
        ['398058083496230935', '443621655630053376'].includes(interaction.user.id) ||
        interaction.guild?.ownerId === interaction.user.id;
      const userName = isFounder
        ? 'Khai (Founder)'
        : (interaction.member?.displayName || interaction.user.username);
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

      const speakResult = await voiceManager.speak(interaction.guildId, speechText, {
        question,
        userName,
        voice: selectedVoice,
      });

      // 4. Friendly label for the voice
      let voiceLabel = selectedVoice;
      if (selectedVoice.includes('Chirp3-HD-Puck')) voiceLabel = 'Chirp 3 HD (Puck - Upbeat Generative)';
      else if (selectedVoice.includes('Chirp3-HD-Zubenelgenubi')) voiceLabel = 'Chirp 3 HD (Zuben - Chill Casual)';
      else if (selectedVoice.includes('Chirp3-HD-Fenrir')) voiceLabel = 'Chirp 3 HD (Fenrir - Energetic)';
      else if (selectedVoice.includes('Chirp3-HD-Despina')) voiceLabel = 'Chirp 3 HD (Despina - Smooth Female)';
      else if (selectedVoice.includes('Chirp3-HD-Aoede')) voiceLabel = 'Chirp 3 HD (Aoede - Breezy Female)';
      else if (selectedVoice.includes('Casual') || selectedVoice.includes('Casual-K')) voiceLabel = 'English (Casual-K - Conversational HD)';
      else if (selectedVoice.includes('Studio-Q') || selectedVoice.includes('Guy')) voiceLabel = 'English (Studio-Q - Studio HD)';
      else if (selectedVoice.includes('Studio-O') || selectedVoice.includes('Jenny')) voiceLabel = 'English (Studio-O - Studio HD)';
      else if (selectedVoice.includes('Wavenet-B') || selectedVoice.includes('Osman')) voiceLabel = 'Malay (WaveNet-B - Male HD)';
      else if (selectedVoice.includes('Wavenet-A') || selectedVoice.includes('Yasmin')) voiceLabel = 'Malay (WaveNet-A - Female HD)';

      // 5. Display the response embed in text chat
      const isMusicPlaying = guildState?.currentTrack?.type === 'song';
      const isSpeakingNow = speakResult?.isSpeakingNow;
      const queuePos = speakResult?.queuePosition || 1;

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Voice' })
        .setTitle(isSpeakingNow ? 'VOICE DIALOGUE' : 'VOICE QUEUED')
        .addFields(
          { name: 'USER', value: `<@${interaction.user.id}>`, inline: true },
          {
            name: 'STATUS',
            value: isSpeakingNow ? 'Active' : `Queued (#${queuePos})`,
            inline: true,
          },
          { name: 'PROMPT', value: question.slice(0, 1024) },
          { name: 'RESPONSE', value: rawText.slice(0, 1024) }
        )
        .setFooter({
          text: `#${channelName} • ${voiceLabel}${isMusicPlaying ? ' • ducked' : ''}${memoryTurns > 1 ? ` • ${memoryTurns} turns` : ''} • kh.ai voice`,
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /ask question:', error);
      return interaction.editReply({
        content: `An error occurred while generating the answer: ${error.message || 'Unknown error'}`,
      });
    }
  },
};
