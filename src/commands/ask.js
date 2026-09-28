const { SlashCommandBuilder } = require('discord.js');
const helpCommand = require('./help');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI assistant anything and it will respond out loud in your voice channel')
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('What do you want to ask?')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('voice')
        .setDescription('Optional: Choose speaker persona')
        .setRequired(false)
        .addChoices(
          { name: 'Auto (Malay: Yasmin / English: Guy)', value: 'auto' },
          { name: 'Malay (Yasmin - Female)', value: 'yasmin' },
          { name: 'Malay (Osman - Male)', value: 'osman' },
          { name: 'English (Guy - Male)', value: 'guy' },
          { name: 'English (Jenny - Female)', value: 'jenny' }
        )
    ),

  execute: helpCommand.execute,
};
