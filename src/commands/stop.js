const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop current voice playback and clear the audio queue'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../voice/player').VoiceManager} voiceManager
   */
  async execute(interaction, { voiceManager }) {
    const stopped = voiceManager.stop(interaction.guildId);

    if (!stopped) {
      return interaction.reply({
        content: '❌ No audio is currently playing in this server.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: '⏹️ Stopped playback and cleared the voice queue.',
    });
  },
};
