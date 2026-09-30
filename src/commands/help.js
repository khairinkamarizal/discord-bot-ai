const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View the command directory and system guide'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'kh.AI Help' })
      .setTitle('COMMAND DIRECTORY')
      .setDescription(
        'Comprehensive index of controls for voice dialogue, streaming audio, and image synthesis.'
      )
      .addFields(
        {
          name: 'VOICE & INTELLIGENCE',
          value:
            '`/ask <question> [voice]`\nInquire aloud in the voice channel with natural dialogue.\n\n' +
            '`/say <text> [voice]`\nRender custom text into speech in your voice channel.\n\n' +
            '`/imagine <prompt> [reference]`\nSynthesize visuals from text or transform reference images.\n\n' +
            '`/roastmode <on|off>`\nToggle ambient voice greetings upon channel entry.\n\n' +
            '`/reset`\nClear conversational context for the current session.\n\n' +
            '`@kh.AI <message>`\nEngage directly in any text channel.',
        },
        {
          name: 'AUDIO & STREAMING',
          value:
            '`/play <query>`\nStream audio tracks from supported online platforms.\n\n' +
            '`/radio <station>`\nBroadcast continuous 24/7 curated radio channels.\n\n' +
            '`/volume [1-100] [channel]`\nInspect or regulate volume across music, voice, or master.\n\n' +
            '`/pause` / `/resume`\nSuspend or resume active audio playback.\n\n' +
            '`/skip`\nAdvance to the subsequent track in the queue.\n\n' +
            '`/queue`\nDisplay upcoming scheduled tracks.\n\n' +
            '`/stop`\nTerminate playback and clear the playlist.',
        },
        {
          name: 'CHANNEL CONTROLS',
          value:
            '`/join`\nConnect kh.AI to your active voice channel.\n\n' +
            '`/disconnect`\nDisconnect from the voice channel and release session.',
        }
      )
      .setFooter({
        text: 'kh.ai help',
      })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
