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

    const hasMusic = queueData && (queueData.currentItem || queueData.queue.length > 0);
    const hasSpeech = queueData && (queueData.currentSpeech || (queueData.speechQueue && queueData.speechQueue.length > 0));

    if (!queueData || (!hasMusic && !hasSpeech)) {
      return interaction.reply({
        content: 'The voice queue is currently empty.',
        ephemeral: true,
      });
    }

    const {
      currentItem,
      queue,
      isPaused,
      channelName,
      isSpeaking,
      currentSpeech,
      speechQueue,
    } = queueData;

    const currentTitle = currentItem?.title || 'None';
    const currentArtist = currentItem?.author ? ` - ${currentItem.author}` : '';
    const currentDuration = currentItem?.duration ? ` [${currentItem.duration}]` : '';

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'KH.AI STUDIO' })
      .setTitle('QUEUE DIRECTORY')
      .setTimestamp();

    if (currentItem) {
      embed.setDescription(
        `**Current Track**\n${isPaused ? '[Paused] ' : ''}**${currentTitle}**${currentArtist}${currentDuration}`
      );
    } else if (currentSpeech) {
      const speechLabel = currentSpeech.text ? `"${currentSpeech.text.slice(0, 100)}..."` : 'Sound Effect';
      embed.setDescription(`**Active Speech**\n${speechLabel}`);
    } else {
      embed.setDescription('Idle. No audio actively playing.');
    }

    // Speech Queue section
    if (currentSpeech || (speechQueue && speechQueue.length > 0)) {
      let speechList = '';
      if (currentSpeech) {
        const who = currentSpeech.userName ? ` (${currentSpeech.userName})` : '';
        const what = currentSpeech.text ? `"${currentSpeech.text.slice(0, 80)}"` : 'Sound effect';
        speechList += `Active: ${what}${who}\n`;
      }
      if (speechQueue && speechQueue.length > 0) {
        speechList += speechQueue
          .slice(0, 5)
          .map((s, idx) => {
            const who = s.userName ? ` (${s.userName})` : '';
            const what = s.text ? `"${s.text.slice(0, 60)}..."` : 'Sound effect';
            return `\`${idx + 1}.\` ${what}${who}`;
          })
          .join('\n');
        if (speechQueue.length > 5) {
          speechList += `\n*...and ${speechQueue.length - 5} more queued messages*`;
        }
      }
      embed.addFields({ name: 'SPEECH QUEUE', value: speechList });
    }

    // Music Queue section
    if (queue.length > 0) {
      const upcomingList = queue
        .slice(0, 8)
        .map((item, index) => {
          const title = item.title || 'Track';
          const dur = item.duration ? ` \`[${item.duration}]\`` : '';
          return `\`${index + 1}.\` **${title}**${dur}`;
        })
        .join('\n');

      const remaining = queue.length > 8 ? `\n*...and ${queue.length - 8} more tracks*` : '';
      embed.addFields({ name: 'AUDIO TRACKS', value: upcomingList + remaining });
    } else if (hasMusic) {
      embed.addFields({ name: 'AUDIO TRACKS', value: 'No tracks remaining in queue.' });
    }

    embed.setFooter({ text: `#${channelName} • kh.ai studio` });

    return interaction.reply({ embeds: [embed] });
  },
};
