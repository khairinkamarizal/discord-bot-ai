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
      // 1. Generate concise, voice-tailored answer from Gemini
      const { rawText, speechText } = await aiService.askQuestion(question);

      // 2. Queue the audio in the voice channel
      const guildState = voiceManager.getState(interaction.guildId);
      const channelName = guildState?.channelName || 'voice';

      await voiceManager.speak(interaction.guildId, speechText, {
        question,
      });

      // 3. Display the response embed in text chat
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎙️ Voice AI Answer')
        .addFields(
          { name: '❓ Question', value: question.slice(0, 1024) },
          { name: '💬 Spoken Answer', value: rawText.slice(0, 1024) }
        )
        .setFooter({
          text: `🔊 Spoken in #${channelName} • Powered by Gemini & Edge Neural TTS`,
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
