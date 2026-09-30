const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View the list of available commands and how to use kh.AI'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤖 kh.AI — Commands & Guide')
      .setDescription(
        '**kh.AI** is your 24/7 Discord companion powered by Vertex AI and Google Cloud Studio & WaveNet TTS, founded & built by **Khairin (Khai)**.\n\n' +
        'Here are all the commands you can use:'
      )
      .addFields(
        {
          name: '🎙️ Voice AI & Chat',
          value:
            '• `/ask <question> [voice]` — Ask kh.AI anything out loud in voice chat (funny rude & savage banter!).\n' +
            '• `/say <text> [voice]` — Make kh.AI speak whatever text you want out loud in the voice channel!\n' +
            '• `@kh.AI <message>` — Mention kh.AI in any text channel to chat directly in text!\n' +
            '• `/roastmode <on|off>` — Toggle auto-roasting when members join voice.\n' +
            '• `/reset` — Clear conversational memory for this channel.',
        },
        {
          name: '🎵 Music & 24/7 Radio',
          value:
            '• `/radio <station>` — Stream 24/7 live continuous radio (Lofi, Synthwave, Ambient Chill, Cafe Jazz).\n' +
            '• `/play <song>` — Play music from YouTube/Spotify in voice.\n' +
            '• `/volume <1-100>` — Adjust playback volume (default: 20%).\n' +
            '• `/pause` & `/resume` — Pause or resume playback.\n' +
            '• `/skip` — Skip to the next song in queue.\n' +
            '• `/queue` — View upcoming queued tracks.\n' +
            '• `/stop` — Stop music/radio and clear queue.',
        },
        {
          name: '🔊 Voice Channel & VIP',
          value:
            '• `/join` — Connect kh.AI to your voice channel (stays 24/7).\n' +
            '• `/disconnect` — Disconnect the bot from the voice channel.\n' +
            '• 👑 *Khai VIP Entrance* — Epic boss sound & royal welcome when Khai joins voice!',
        }
      )
      .setFooter({
        text: 'kh.AI • Founded & Developed by Khairin (Khai)',
      })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
