const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current song and upcoming queue'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    const queueData = voiceManager.getQueue(interaction.guildId);

    if (!queueData || (!queueData.currentItem && queueData.queue.length === 0)) {
      return interaction.reply({
        content: '📭 The voice queue is currently empty.',
        ephemeral: true,
      });
    }

    const { currentItem, queue, isPaused, channelName } = queueData;

    const currentTitle =
      currentItem?.title || (currentItem?.type === 'tts' ? '🎙️ AI Voice Response' : 'Unknown');
    const currentArtist = currentItem?.author ? ` - ${currentItem.author}` : '';
    const currentDuration = currentItem?.duration ? ` [${currentItem.duration}]` : '';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎵 Music Queue - #${channelName}`)
      .setDescription(
        `**Now Playing:**\n${isPaused ? '⏸️ (Paused) ' : '▶️ '}**${currentTitle}**${currentArtist}${currentDuration}`
      )
      .setTimestamp();

    if (queue.length > 0) {
      const upcomingList = queue
        .slice(0, 10)
        .map((item, index) => {
          const title = item.title || (item.type === 'tts' ? '🎙️ AI Voice Response' : 'Track');
          const dur = item.duration ? ` \`[${item.duration}]\`` : '';
          return `\`${index + 1}.\` **${title}**${dur}`;
        })
        .join('\n');

      const remaining = queue.length > 10 ? `\n*...and ${queue.length - 10} more*` : '';
      embed.addFields({ name: 'Upcoming in Queue', value: upcomingList + remaining });
    } else {
      embed.addFields({ name: 'Upcoming in Queue', value: 'No more tracks queued.' });
    }

    return interaction.reply({ embeds: [embed] });
  },
};
