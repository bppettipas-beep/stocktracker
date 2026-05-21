require('dotenv').config();
const {
    Client, GatewayIntentBits, Events, ChannelType,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

async function pushLiveEmbeds(stock) {
    const tracked = await db.getStockMessages(stock.id);
    for (const { channelId, messageId } of tracked) {
        try {
            const channel = await client.channels.fetch(channelId);
            const message = await channel.messages.fetch(messageId);
            await message.edit({ embeds: [buildChannelEmbed(stock)] });
        } catch {
            await db.deleteStockMessage(channelId).catch(() => {});
        }
    }
}

// ─── Embed builders ──────────────────────────────────────────────────────────

function formatVal(n) {
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function buildChannelEmbed(stock) {
    const title = stock.emoji ? `${stock.emoji}  ${stock.name}` : stock.name;
    return new EmbedBuilder()
        .setTitle(`📈  ${title}`)
        .setDescription(`### Current Value\n\`\`\`\n${formatVal(stock.value)}\n\`\`\``)
        .setColor(stock.value >= 0 ? 0x2ecc71 : 0xe74c3c)
        .setFooter({ text: '📊 Stock Tracker' })
        .setTimestamp();
}

function buildPanel(stock, note = null) {
    const title = stock.emoji ? `${stock.emoji}  ${stock.name}` : stock.name;

    const embed = new EmbedBuilder()
        .setTitle(`📊  ${title}`)
        .setColor(0x5865f2)
        .addFields(
            { name: '💰 Current Value',  value: `\`${formatVal(stock.value)}\``,        inline: true },
            { name: '🔰 Starting Value', value: `\`${formatVal(stock.initialValue)}\``, inline: true },
            { name: '​',            value: '​',                                inline: true },
            { name: '📁 Category',       value: stock.categoryName,                      inline: true },
            { name: '⏱️ Delay',          value: `${stock.delaySeconds}s`,               inline: true },
            { name: '​',            value: '​',                                inline: true },
        )
        .setTimestamp();

    if (note) embed.setDescription(`> ${note}`);

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ss_add_${stock.id}`).setLabel('Add')     .setStyle(ButtonStyle.Success)  .setEmoji('➕'),
        new ButtonBuilder().setCustomId(`ss_sub_${stock.id}`).setLabel('Subtract').setStyle(ButtonStyle.Danger)   .setEmoji('➖'),
        new ButtonBuilder().setCustomId(`ss_mul_${stock.id}`).setLabel('Multiply').setStyle(ButtonStyle.Primary)  .setEmoji('✖️'),
        new ButtonBuilder().setCustomId(`ss_div_${stock.id}`).setLabel('Divide')  .setStyle(ButtonStyle.Primary)  .setEmoji('➗'),
        new ButtonBuilder().setCustomId(`ss_rst_${stock.id}`).setLabel('Reset')   .setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
    );

    return { embed, btnRow };
}

// ─── Client ──────────────────────────────────────────────────────────────────

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

const addSessions   = new Map(); // userId → partial stock config waiting for category selection
const emojiSessions = new Map(); // userId → emoji string waiting for stock selection

client.once(Events.ClientReady, () => {
    console.log(`✅  Online as ${client.user.tag} | ${new Date().toISOString()}`);
});

// ─── Channel watcher ─────────────────────────────────────────────────────────

client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.parentId || channel.type === ChannelType.GuildCategory) return;

    const stocks = await db.getStocks(channel.guild.id);
    const stock  = stocks.find(s => s.categoryId === channel.parentId);
    if (!stock) return;

    setTimeout(async () => {
        try {
            const fresh = (await db.getStocks(channel.guild.id)).find(s => s.id === stock.id) ?? stock;
            const msg = await channel.send({ embeds: [buildChannelEmbed(fresh)] });
            await db.saveStockMessage(fresh.id, channel.id, msg.id, channel.guild.id);
        } catch (err) {
            console.error(`[StockTracker] Could not send to #${channel.name}:`, err.message);
        }
    }, stock.delaySeconds * 1000);
});

client.on(Events.ChannelDelete, async (channel) => {
    await db.deleteStockMessage(channel.id).catch(() => {});
});

// ─── Interaction router ──────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'stockadd')     return await cmdStockAdd(interaction);
            if (interaction.commandName === 'stockset')     return await cmdStockSet(interaction);
            if (interaction.commandName === 'setstockemoji') return await cmdSetStockEmoji(interaction);
        }
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_stockadd')    return await modalStockAdd(interaction);
            if (interaction.customId.startsWith('modal_ss_')) return await modalStockSet(interaction);
        }
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'sa_category') return await selectCategory(interaction);
            if (interaction.customId === 'ss_pick')     return await selectStock(interaction);
            if (interaction.customId === 'se_pick')     return await selectStockEmoji(interaction);
        }
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('ss_')) return await buttonStockSet(interaction);
        }
    } catch (err) {
        console.error('[StockTracker] Interaction error:', err);
        const payload = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
        if (interaction.replied || interaction.deferred) interaction.followUp(payload).catch(() => {});
        else interaction.reply(payload).catch(() => {});
    }
});

// ─── /stockadd ───────────────────────────────────────────────────────────────

async function cmdStockAdd(interaction) {
    await interaction.showModal(
        new ModalBuilder()
            .setCustomId('modal_stockadd')
            .setTitle('➕  Add New Stock')
            .addComponents(
                row(new TextInputBuilder()
                    .setCustomId('sa_name').setLabel('Stock Name').setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. Gold, Credits, Gems…').setRequired(true).setMaxLength(50)),
                row(new TextInputBuilder()
                    .setCustomId('sa_emoji').setLabel('Emoji  (optional)').setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 🥇  — leave blank for none').setRequired(false).setMaxLength(8)),
                row(new TextInputBuilder()
                    .setCustomId('sa_value').setLabel('Starting Value').setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 1000').setRequired(true).setMaxLength(20)),
                row(new TextInputBuilder()
                    .setCustomId('sa_delay').setLabel('Delay after channel creation (seconds)').setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 30  (use 0 for instant)').setRequired(true).setMaxLength(8)),
            )
    );
}

async function modalStockAdd(interaction) {
    const name     = interaction.fields.getTextInputValue('sa_name').trim();
    const emoji    = interaction.fields.getTextInputValue('sa_emoji').trim() || null;
    const valueStr = interaction.fields.getTextInputValue('sa_value').trim();
    const delayStr = interaction.fields.getTextInputValue('sa_delay').trim();

    const value = parseFloat(valueStr);
    const delay = parseInt(delayStr, 10);

    if (isNaN(value))              return interaction.reply({ content: '❌ Starting value must be a number.',      ephemeral: true });
    if (isNaN(delay) || delay < 0) return interaction.reply({ content: '❌ Delay must be 0 or a positive number.', ephemeral: true });

    const categories = [...interaction.guild.channels.cache.values()]
        .filter(c => c.type === ChannelType.GuildCategory)
        .slice(0, 25);

    if (!categories.length) return interaction.reply({ content: '❌ No categories found in this server.', ephemeral: true });

    addSessions.set(interaction.user.id, { name, emoji, value, delay });

    const displayName = emoji ? `${emoji}  ${name}` : name;

    const embed = new EmbedBuilder()
        .setTitle('📁  Choose a Category')
        .setDescription(
            `**${displayName}** will post a live stock embed into every new channel created under the selected category.\n\nPick where to watch:`
        )
        .addFields(
            { name: '💰 Starting Value', value: `\`${formatVal(value)}\``, inline: true },
            { name: '⏱️ Delay',          value: `\`${delay}s\``,          inline: true },
        )
        .setColor(0x5865f2);

    const select = new StringSelectMenuBuilder()
        .setCustomId('sa_category')
        .setPlaceholder('Select a category…')
        .addOptions(categories.map(c => ({ label: c.name, value: c.id })));

    await interaction.reply({ embeds: [embed], components: [row(select)], ephemeral: true });
}

async function selectCategory(interaction) {
    const session = addSessions.get(interaction.user.id);
    if (!session) return interaction.update({ content: '❌ Session expired — run `/stockadd` again.', embeds: [], components: [] });

    const categoryId = interaction.values[0];
    const category   = interaction.guild.channels.cache.get(categoryId);
    if (!category) return interaction.update({ content: '❌ Category not found.', embeds: [], components: [] });

    addSessions.delete(interaction.user.id);

    const stock = {
        id:           Date.now().toString(36),
        name:         session.name,
        emoji:        session.emoji,
        value:        session.value,
        initialValue: session.value,
        categoryId,
        categoryName: category.name,
        delaySeconds: session.delay,
        guildId:      interaction.guild.id,
    };

    await db.upsertStock(stock);

    const displayName = stock.emoji ? `${stock.emoji}  ${stock.name}` : stock.name;

    const embed = new EmbedBuilder()
        .setTitle('✅  Stock Created!')
        .setDescription(
            `**${displayName}** is now active.\n\nEvery new channel created under **${category.name}** will receive the stock embed` +
            (stock.delaySeconds > 0 ? ` after a **${stock.delaySeconds}s** delay.` : ' instantly.')
        )
        .addFields(
            { name: '💰 Starting Value', value: `\`${formatVal(stock.value)}\``, inline: true },
            { name: '📁 Category',       value: category.name,                   inline: true },
            { name: '⏱️ Delay',          value: `${stock.delaySeconds}s`,        inline: true },
        )
        .setColor(0x2ecc71)
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
}

// ─── /stockset ───────────────────────────────────────────────────────────────

async function cmdStockSet(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });
    }

    const stocks = await db.getStocks(interaction.guild.id);
    if (!stocks.length) return interaction.reply({ content: '❌ No stocks configured. Use `/stockadd` first.', ephemeral: true });

    if (stocks.length === 1) {
        const { embed, btnRow } = buildPanel(stocks[0]);
        return interaction.reply({ embeds: [embed], components: [btnRow], ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('ss_pick')
        .setPlaceholder('Select a stock to manage…')
        .addOptions(
            stocks.slice(0, 25).map(s => ({
                label:       `${s.emoji ? s.emoji + '  ' : ''}${s.name}`,
                value:       s.id,
                description: `Value: ${formatVal(s.value)}  ·  Category: ${s.categoryName}`,
            }))
        );

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle('📊  Stock Manager')
                .setDescription('Select a stock to manage:')
                .setColor(0x5865f2),
        ],
        components: [row(select)],
        ephemeral: true,
    });
}

async function selectStock(interaction) {
    const stocks = await db.getStocks(interaction.guild.id);
    const stock  = stocks.find(s => s.id === interaction.values[0]);
    if (!stock) return interaction.update({ content: '❌ Stock not found.', embeds: [], components: [] });

    const { embed, btnRow } = buildPanel(stock);
    await interaction.update({ embeds: [embed], components: [btnRow] });
}

async function buttonStockSet(interaction) {
    // customId: ss_<op>_<stockId>   op ∈ {add, sub, mul, div, rst}
    const [, op, stockId] = interaction.customId.split('_');

    if (op === 'rst') {
        const stocks = await db.getStocks(interaction.guild.id);
        const stock  = stocks.find(s => s.id === stockId);
        if (!stock) return interaction.update({ content: '❌ Stock not found.', embeds: [], components: [] });

        await db.updateStockValue(stockId, stock.initialValue);
        stock.value = stock.initialValue;

        pushLiveEmbeds(stock).catch(() => {});
        const { embed, btnRow } = buildPanel(stock, `🔄 Reset to starting value: \`${formatVal(stock.value)}\``);
        return interaction.update({ embeds: [embed], components: [btnRow] });
    }

    const labels = { add: 'Add to Stock', sub: 'Subtract from Stock', mul: 'Multiply Stock By', div: 'Divide Stock By' };

    await interaction.showModal(
        new ModalBuilder()
            .setCustomId(`modal_ss_${op}_${stockId}`)
            .setTitle(labels[op] ?? 'Edit Stock')
            .addComponents(
                row(new TextInputBuilder()
                    .setCustomId('ss_val').setLabel('Value').setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 50').setRequired(true).setMaxLength(20))
            )
    );
}

async function modalStockSet(interaction) {
    // customId: modal_ss_<op>_<stockId>
    const [, , op, stockId] = interaction.customId.split('_');
    const operand = parseFloat(interaction.fields.getTextInputValue('ss_val').trim());

    if (isNaN(operand))                                  return interaction.reply({ content: '❌ Enter a valid number.',               ephemeral: true });
    if ((op === 'mul' || op === 'div') && operand === 0) return interaction.reply({ content: '❌ Cannot multiply or divide by zero.', ephemeral: true });

    const stocks = await db.getStocks(interaction.guild.id);
    const stock  = stocks.find(s => s.id === stockId);
    if (!stock) return interaction.reply({ content: '❌ Stock not found.', ephemeral: true });

    const before = stock.value;
    switch (op) {
        case 'add': stock.value += operand; break;
        case 'sub': stock.value -= operand; break;
        case 'mul': stock.value *= operand; break;
        case 'div': stock.value /= operand; break;
    }
    stock.value = Math.round(stock.value * 100) / 100;

    await db.updateStockValue(stockId, stock.value);

    pushLiveEmbeds(stock).catch(() => {});

    const symbol = { add: '➕', sub: '➖', mul: '✖️', div: '➗' }[op];
    const note   = `${symbol} \`${formatVal(before)}\` ${symbol} \`${operand}\` → \`${formatVal(stock.value)}\``;

    const { embed, btnRow } = buildPanel(stock, note);

    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [embed], components: [btnRow] });
}

// ─── /setstockemoji ──────────────────────────────────────────────────────────

async function cmdSetStockEmoji(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });
    }

    const emoji  = interaction.options.getString('emoji')?.trim() || null;
    const stocks = await db.getStocks(interaction.guild.id);
    if (!stocks.length) return interaction.reply({ content: '❌ No stocks configured. Use `/stockadd` first.', ephemeral: true });

    if (stocks.length === 1) return applyStockEmoji(interaction, stocks[0], emoji, false);

    emojiSessions.set(interaction.user.id, emoji);

    const select = new StringSelectMenuBuilder()
        .setCustomId('se_pick')
        .setPlaceholder('Select a stock…')
        .addOptions(
            stocks.slice(0, 25).map(s => ({
                label:       `${s.emoji ? s.emoji + '  ' : ''}${s.name}`,
                value:       s.id,
                description: `Current emoji: ${s.emoji ?? 'none'}`,
            }))
        );

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle('🎨  Set Stock Emoji')
                .setDescription(emoji ? `Which stock should use **${emoji}**?` : 'Which stock should have its emoji removed?')
                .setColor(0x5865f2),
        ],
        components: [row(select)],
        ephemeral: true,
    });
}

async function selectStockEmoji(interaction) {
    const emoji = emojiSessions.get(interaction.user.id) ?? null;
    emojiSessions.delete(interaction.user.id);

    const stocks = await db.getStocks(interaction.guild.id);
    const stock  = stocks.find(s => s.id === interaction.values[0]);
    if (!stock) return interaction.update({ content: '❌ Stock not found.', embeds: [], components: [] });

    await applyStockEmoji(interaction, stock, emoji, true);
}

async function applyStockEmoji(interaction, stock, emoji, isUpdate) {
    await db.updateStockEmoji(stock.id, emoji);
    stock.emoji = emoji;

    pushLiveEmbeds(stock).catch(() => {});

    const displayName = emoji ? `${emoji}  ${stock.name}` : stock.name;
    const embed = new EmbedBuilder()
        .setTitle('✅  Emoji Updated')
        .setDescription(emoji ? `**${displayName}** emoji set to ${emoji}.` : `Emoji removed from **${stock.name}**.`)
        .setColor(0x2ecc71)
        .setTimestamp();

    if (isUpdate) await interaction.update({ embeds: [embed], components: [] });
    else await interaction.reply({ embeds: [embed], components: [], ephemeral: true });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function row(component) {
    return new ActionRowBuilder().addComponents(component);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

db.init()
    .then(() => client.login(process.env.BOT_TOKEN))
    .catch(err => { console.error('Startup failed:', err); process.exit(1); });
