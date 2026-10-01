const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perform')
    .setDescription('Make kh.AI perform a live rap, song, pantun, or diss track in voice chat')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Choose performance style')
        .setRequired(true)
        .addChoices(
          { name: 'Freestyle Rap (Hip-hop bars & rhymes)', value: 'rap' },
          { name: 'Melodic Song (Soulful ballad / hook)', value: 'sing' },
          { name: 'Pantun & Spoken Word (Malay poetry)', value: 'poem' },
          { name: 'Roast Diss Track (Playful friendly banter)', value: 'diss' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('topic')
        .setDescription('What should the performance be about?')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('target')
        .setDescription('Optional: Mention or name someone to roast or dedicate to')
        .setRequired(false)
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
    const mode = interaction.options.getString('mode');
    const topic = interaction.options.getString('topic');
    const target = interaction.options.getString('target');
    const requestedVoice = interaction.options.getString('voice');

    // Defer reply immediately since creative generation + TTS synthesis takes 1-3s
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
          console.error('Auto-join voice channel failed in /perform:', err);
        }
      }
    }

    if (!isConnected) {
      return interaction.editReply({
        content:
          'Not connected to a voice channel. Please join a voice channel and run `/join` first, or be inside a voice channel when using `/perform`.',
      });
    }

    try {
      // 1. Generate live creative performance lyrics from Gemini
      const { rawText, speechText, langCode, modeTitle } = await aiService.generatePerformance(
        mode,
        topic,
        target
      );

      // 2. Resolve high-fidelity voice (Chirp 3 HD default)
      const selectedVoice = voiceManager.ttsService.resolveVoice(
        langCode,
        `${topic} ${speechText}`,
        requestedVoice === 'auto' ? null : requestedVoice
      );

      // 3. Play vocal performance in voice channel with mode-adapted prosody
      const guildState = voiceManager.getState(interaction.guildId);
      const channelName = guildState?.channelName || 'voice';

      const speakResult = await voiceManager.speak(interaction.guildId, speechText, {
        mode,
        topic,
        userName: interaction.member?.displayName || interaction.user.username,
        voice: selectedVoice,
      });

      // 4. Resolve friendly voice label
      let voiceLabel = selectedVoice;
      if (selectedVoice.includes('Chirp3-HD-Puck')) voiceLabel = 'Chirp 3 HD (Puck)';
      else if (selectedVoice.includes('Chirp3-HD-Zubenelgenubi')) voiceLabel = 'Chirp 3 HD (Zuben)';
      else if (selectedVoice.includes('Chirp3-HD-Fenrir')) voiceLabel = 'Chirp 3 HD (Fenrir)';
      else if (selectedVoice.includes('Chirp3-HD-Despina')) voiceLabel = 'Chirp 3 HD (Despina)';
      else if (selectedVoice.includes('Chirp3-HD-Aoede')) voiceLabel = 'Chirp 3 HD (Aoede)';
      else if (selectedVoice.includes('Casual-K') || selectedVoice.includes('Casual')) voiceLabel = 'Casual-K';
      else if (selectedVoice.includes('Studio-Q') || selectedVoice.includes('Guy')) voiceLabel = 'Studio-Q';
      else if (selectedVoice.includes('Wavenet-B') || selectedVoice.includes('Osman')) voiceLabel = 'WaveNet-B';
      else if (selectedVoice.includes('Wavenet-A') || selectedVoice.includes('Yasmin')) voiceLabel = 'WaveNet-A';

      // 5. Render luxury all-black embed with lyrics
      const isMusicPlaying = guildState?.currentTrack?.type === 'song';
      const isSpeakingNow = speakResult?.isSpeakingNow;
      const queuePos = speakResult?.queuePosition || 1;

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Studio' })
        .setTitle(isSpeakingNow ? 'VOCAL PERFORMANCE' : 'VOCAL PERFORMANCE QUEUED')
        .addFields(
          { name: 'STYLE', value: modeTitle, inline: true },
          {
            name: 'STATUS',
            value: isSpeakingNow ? 'Live on Mic' : `Queued (#${queuePos})`,
            inline: true,
          },
          {
            name: 'THEME',
            value: target ? `${topic}\n(Dedicated to ${target})` : topic,
            inline: false,
          },
          { name: 'LYRICS', value: rawText.slice(0, 1024) }
        )
        .setFooter({
          text: `#${channelName} • ${voiceLabel}${isMusicPlaying ? ' • ducked' : ''} • kh.ai studio`,
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /perform command:', error);
      return interaction.editReply({
        content: `An error occurred while generating the performance: ${error.message || 'Unknown error'}`,
      });
    }
  },
};
