const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song in your voice channel (search by name, SoundCloud, or Spotify link)')
    .addStringOption((option) =>
      option
        .setName('song')
        .setDescription('Song title, artist name, or music URL')
        .setRequired(true)
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager, musicService: import('../services/music').MusicService }} services
   */
  async execute(interaction, { voiceManager, musicService }) {
    const query = interaction.options.getString('song');
    const userChannel = interaction.member?.voice?.channel;

    if (!userChannel) {
      return interaction.reply({
        content: '❌ You need to be in a voice channel first to play music!',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // Check channel permissions
    const permissions = userChannel.permissionsFor(interaction.client.user);
    if (permissions && !permissions.has(PermissionFlagsBits.Connect)) {
      return interaction.editReply({
        content: '❌ I do not have permission to **Connect** to this voice channel! Please check channel permissions.',
      });
    }
    if (permissions && !permissions.has(PermissionFlagsBits.Speak)) {
      return interaction.editReply({
        content: '❌ I do not have permission to **Speak** in this voice channel! Please check channel permissions.',
      });
    }

    // Ensure bot is in voice channel
    try {
      await voiceManager.join(userChannel);
    } catch (err) {
      console.error('Failed to join voice channel for /play:', err);
      return interaction.editReply({
        content: `❌ Could not connect to your voice channel: ${err.message || 'Connection timed out'}. Please check bot permissions.`,
      });
    }

    try {
      // Search and extract audio stream URL or full playlist
      const searchResult = await musicService.searchAndExtract(query, interaction.user);

      if (!searchResult) {
        return interaction.editReply({
          content: `❌ No results found for: **${query}**`,
        });
      }

      // CASE 1: Playlist (Spotify playlist/album, SoundCloud set, etc.)
      if (searchResult.isPlaylist) {
        const result = await voiceManager.playPlaylist(interaction.guildId, searchResult.tracks);

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setTitle('📋 Playlist Added to Queue')
          .setDescription(`[**${searchResult.playlist.title}**](${searchResult.playlist.url})`)
          .addFields(
            {
              name: '🎵 Total Tracks',
              value: `${searchResult.playlist.trackCount} songs`,
              inline: true,
            },
            {
              name: '👤 Creator',
              value: searchResult.playlist.author || 'Various Artists',
              inline: true,
            },
            {
              name: '📊 Queue Status',
              value: result.isPlayingNow
                ? `▶️ Playing now: **${result.firstTrack.title}**`
                : `Queued at position #${result.queuePosition}`,
              inline: true,
            }
          )
          .setFooter({
            text: `Requested by ${interaction.user.tag} • Plays until /disconnect`,
            iconURL: interaction.user.displayAvatarURL(),
          })
          .setTimestamp();

        if (searchResult.playlist.thumbnail) {
          embed.setThumbnail(searchResult.playlist.thumbnail);
        }

        return interaction.editReply({ embeds: [embed] });
      }

      // CASE 2: Single Song
      const song = searchResult.song;
      const result = await voiceManager.playSong(interaction.guildId, song);

      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle(result.isPlayingNow ? '▶️ Now Playing' : '🎵 Added to Queue')
        .setDescription(`[**${song.title}**](${song.url})`)
        .addFields(
          { name: '👤 Artist / Channel', value: song.author || 'Unknown', inline: true },
          { name: '⏱️ Duration', value: song.duration || 'Live / Unknown', inline: true },
          {
            name: '📊 Queue Position',
            value: result.isPlayingNow ? 'Playing Now' : `#${result.position}`,
            inline: true,
          }
        )
        .setFooter({
          text: `Requested by ${interaction.user.tag} • Plays until /disconnect`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      if (song.thumbnail) {
        embed.setThumbnail(song.thumbnail);
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in /play command:', error);
      return interaction.editReply({
        content: `❌ Error playing song: ${error.message || 'An unexpected error occurred.'}`,
      });
    }
  },
};
