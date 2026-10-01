const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perform')
    .setDescription('Make kh.AI perform a live song, rap, diss track, or spoken word with Google Lyria 3')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Choose performance style')
        .setRequired(true)
        .addChoices(
          { name: 'Melodic Song (Acoustic / R&B ballad with real vocals)', value: 'sing' },
          { name: 'Freestyle Rap (90s Boom-Bap MPC hip-hop bars & beat)', value: 'rap' },
          { name: 'Roast Diss Track (Hard-hitting 808 trap beat & witty bars)', value: 'diss' },
          { name: 'Pantun & Spoken Word (Atmospheric lofi neo-soul poetry)', value: 'poem' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('topic')
        .setDescription('What should the track be about?')
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
        .setName('engine')
        .setDescription('Optional: Audio generation engine')
        .setRequired(false)
        .addChoices(
          { name: 'Google Lyria 3 (Full Studio Vocals, Melody & Music)', value: 'lyria' },
          { name: 'Chirp 3 HD (Speech Acapella Recitation)', value: 'chirp' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager, aiService: import('../services/ai').AIService, lyriaService: import('../services/lyria').LyriaService }} services
   */
  async execute(interaction, { voiceManager, aiService, lyriaService }) {
    const mode = interaction.options.getString('mode');
    const topic = interaction.options.getString('topic');
    const target = interaction.options.getString('target');
    const engine = interaction.options.getString('engine') || 'lyria';

    // Defer reply immediately since Lyria generation takes 10-15s
    await interaction.deferReply();

    // Check voice connection status
    let isConnected = voiceManager.isConnected(interaction.guildId);

    // If bot is not connected, auto-join user's voice channel
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

    const guildState = voiceManager.getState(interaction.guildId);
    const channelName = guildState?.channelName || 'voice';

    // Mode labels for embeds
    const modeLabels = {
      sing: 'Acoustic / Melodic Soul Ballad',
      rap: '90s Boom-Bap Hip-Hop',
      diss: '808 Trap Diss Track',
      poem: 'Atmospheric Neo-Soul & Spoken Word',
    };
    const modeTitle = modeLabels[mode] || 'Studio Track';

    // -------------------------------------------------------------
    // ENGINE: Google Lyria 3 (Real Music, Melody, Vocals & Beats)
    // -------------------------------------------------------------
    if (engine === 'lyria' && lyriaService) {
      try {
        const song = await lyriaService.generateSong({ mode, topic, target });

        // Play the generated stereo MP3 track into the voice channel
        const playResult = await voiceManager.playSoundFile(interaction.guildId, song.audioPath, {
          title: `Lyria: ${modeTitle}`,
          mode,
          topic,
          userName: interaction.member?.displayName || interaction.user.username,
        });

        const isSpeakingNow = playResult?.isSpeakingNow ?? true;
        const queuePos = playResult?.queuePosition || 1;

        // Build luxury monochrome embed
        const embed = new EmbedBuilder()
          .setColor(0x111111)
          .setAuthor({ name: 'kh.AI Studio' })
          .setTitle(isSpeakingNow ? 'VOCAL PERFORMANCE' : 'VOCAL PERFORMANCE QUEUED')
          .addFields(
            { name: 'STYLE', value: modeTitle, inline: true },
            {
              name: 'STATUS',
              value: isSpeakingNow ? 'Live on Voice' : `Queued (#${queuePos})`,
              inline: true,
            },
            {
              name: 'THEME',
              value: target ? `${topic}\n(Dedicated to ${target})` : topic,
              inline: false,
            }
          );

        if (song.cleanLyrics) {
          embed.addFields({
            name: 'LYRICS',
            value: song.cleanLyrics.slice(0, 1024),
            inline: false,
          });
        }

        if (song.caption) {
          // Truncate caption cleanly to fit embed limits
          const cleanCaption = song.caption.replace(/^Caption:\s*/i, '').trim();
          embed.addFields({
            name: 'PRODUCTION',
            value: cleanCaption.slice(0, 1024),
            inline: false,
          });
        }

        const bpmText = song.bpm ? ` • ${song.bpm} BPM` : '';
        embed
          .setFooter({
            text: `#${channelName} • Google Lyria 3 HD${bpmText} • 44.1kHz Stereo • kh.ai studio`,
          })
          .setTimestamp();

        // Attach generated MP3 file so users can replay or download in chat
        const attachment = new AttachmentBuilder(song.audioPath, {
          name: `${mode}_${Date.now()}.mp3`,
        });

        return interaction.editReply({
          embeds: [embed],
          files: [attachment],
        });
      } catch (lyriaErr) {
        console.error('Google Lyria 3 error in /perform:', lyriaErr);
        // If Lyria fails (e.g. copyright recitation check or quota), provide clean diagnostic
        return interaction.editReply({
          content: `Vocal generation failed: ${lyriaErr.message || 'Unknown error'}. You can try changing the topic or run with \`engine: Chirp 3 HD\` for speech recitation.`,
        });
      }
    }

    // -------------------------------------------------------------
    // FALLBACK ENGINE: Chirp 3 HD (Speech Acapella Recitation)
    // -------------------------------------------------------------
    try {
      const { rawText, speechText, langCode } = await aiService.generatePerformance(
        mode,
        topic,
        target
      );

      const selectedVoice = voiceManager.ttsService.resolveVoice(
        langCode,
        `${topic} ${speechText}`,
        null
      );

      const speakResult = await voiceManager.speak(interaction.guildId, speechText, {
        mode,
        topic,
        userName: interaction.member?.displayName || interaction.user.username,
        voice: selectedVoice,
      });

      let voiceLabel = selectedVoice;
      if (selectedVoice.includes('Chirp3-HD-Puck')) voiceLabel = 'Chirp 3 HD (Puck)';
      else if (selectedVoice.includes('Chirp3-HD-Zubenelgenubi')) voiceLabel = 'Chirp 3 HD (Zuben)';
      else if (selectedVoice.includes('Chirp3-HD-Fenrir')) voiceLabel = 'Chirp 3 HD (Fenrir)';
      else if (selectedVoice.includes('Chirp3-HD-Despina')) voiceLabel = 'Chirp 3 HD (Despina)';

      const isSpeakingNow = speakResult?.isSpeakingNow;
      const queuePos = speakResult?.queuePosition || 1;

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'kh.AI Studio' })
        .setTitle(isSpeakingNow ? 'VOCAL PERFORMANCE' : 'VOCAL PERFORMANCE QUEUED')
        .addFields(
          { name: 'STYLE', value: `${modeTitle} (Speech Recitation)`, inline: true },
          {
            name: 'STATUS',
            value: isSpeakingNow ? 'Live on Voice' : `Queued (#${queuePos})`,
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
          text: `#${channelName} • ${voiceLabel} • kh.ai studio`,
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling /perform fallback command:', error);
      return interaction.editReply({
        content: `An error occurred while generating the performance: ${error.message || 'Unknown error'}`,
      });
    }
  },
};
