require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('stockadd')
        .setDescription('Add and configure a new stock to track'),
    new SlashCommandBuilder()
        .setName('stockset')
        .setDescription('Manage an existing stock value — Admin only'),
    new SlashCommandBuilder()
        .setName('setstockemoji')
        .setDescription('Set or remove the emoji for a stock — Admin only')
        .addStringOption(opt =>
            opt.setName('emoji')
               .setDescription('New emoji — omit to remove the current emoji')
               .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('stockpanelhere')
        .setDescription('Post the live stock panel in this channel — Admin only'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('Deploying slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Commands deployed successfully!');
    } catch (err) {
        console.error('❌ Deploy failed:', err);
        process.exit(1);
    }
})();
