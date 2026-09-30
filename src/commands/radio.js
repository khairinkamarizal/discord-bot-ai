const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const RADIO_STATIONS = {
  lofi: {
    name: '24/7 Lofi Hip Hop / Chill Beats',
    url: 'https://stream.zeno.fm/f3wvbbqmdg8uv',
    genre: 'Lofi / Study Beats',
  },
  synthwave: {
    name: '24/7 Nightwave Plaza Vaporwave',
    url: 'https://radio.plaza.one/mp3',
    genre: 'Synthwave / Vaporwave',
  },
  chill: {
    name: '24/7 Groove Salad Ambient Chill',
    url: 'https://ice2.somafm.com/groovesalad-128-mp3',
    genre: 'Ambient / Downtempo',
  },
  cafe: {
    name: '24/7 Coffee Shop Jazz & Acoustic',
    url: 'https://stream.zeno.fm/0r0xa792kwzuv',
    genre: 'Cafe Jazz / Acoustic',
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Stream 24/7 continuous radio stations in your voice channel')
    .addStringOption((option) =>
      option
        .setName('station')
        .setDescription('Select a 24/7 radio station')
        .setRequired(true)
        .addChoices(
          { name: '24/7 Lofi Hip Hop (Study & Chill)', value: 'lofi' },
          { name: '24/7 Synthwave & Vaporwave (Nightwave Plaza)', value: 'synthwave' },
          { name: '24/7 Ambient Chill (Groove Salad)', value: 'chill' },
          { name: '24/7 Coffee Shop Jazz Cafe', value: 'cafe' }
        )
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ voiceManager: import('../voice/player').VoiceManager }} services
   */
  async execute(interaction, { voiceManager }) {
    await interaction.deferReply();

    let isConnected = voiceManager.isConnected(interaction.guildId);

    if (!isConnected) {
      const userChannel = interaction.member?.voice?.channel;
      if (userChannel) {
        try {
          await voiceManager.join(userChannel);
          isConnected = true;
        } catch (err) {
          console.error('Auto-join voice channel failed in /radio:', err);
        }
      }
    }

    if (!isConnected) {
      return interaction.editReply({
        content: 'Please join a voice channel first before starting the radio.',
      });
    }

    const stationKey = interaction.options.getString('station');
    const station = RADIO_STATIONS[stationKey] || RADIO_STATIONS.lofi;

    const track = {
      type: 'song',
      title: station.name,
      author: '24/7 Live Stream',
      streamUrl: station.url,
      url: station.url,
      duration: 'LIVE 24/7',
      thumbnail: null,
    };

    // Play immediately and replace any queued tracks
    await voiceManager.playSong(interaction.guildId, track, true);

    const guildState = voiceManager.getState(interaction.guildId);
    const channelName = guildState?.channelName || 'voice';

    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setAuthor({ name: 'kh.AI Audio' })
      .setTitle('RADIO BROADCAST')
      .setDescription(`Streaming **${station.name}** in **#${channelName}**`)
      .addFields(
        { name: 'GENRE', value: station.genre, inline: true },
        { name: 'OUTPUT LEVEL', value: `${Math.round((guildState?.volume ?? 0.20) * 100)}%`, inline: true },
        { name: 'CONTROLS', value: 'Use /volume to adjust levels, or /stop to terminate broadcast.' }
      )
      .setFooter({
        text: 'kh.ai audio',
      })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
