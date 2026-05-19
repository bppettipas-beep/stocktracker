const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function init() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS stocks (
            id            TEXT    PRIMARY KEY,
            guild_id      TEXT    NOT NULL,
            name          TEXT    NOT NULL,
            emoji         TEXT,
            value         NUMERIC NOT NULL,
            initial_value NUMERIC NOT NULL,
            category_id   TEXT    NOT NULL,
            category_name TEXT    NOT NULL,
            delay_seconds INTEGER NOT NULL
        )
    `);
    console.log('[DB] Ready');
}

async function getStocks(guildId) {
    const { rows } = await pool.query(
        'SELECT * FROM stocks WHERE guild_id = $1 ORDER BY id',
        [guildId]
    );
    return rows.map(toStock);
}

async function upsertStock(stock) {
    await pool.query(`
        INSERT INTO stocks (id, guild_id, name, emoji, value, initial_value, category_id, category_name, delay_seconds)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
            name          = EXCLUDED.name,
            emoji         = EXCLUDED.emoji,
            value         = EXCLUDED.value,
            category_id   = EXCLUDED.category_id,
            category_name = EXCLUDED.category_name,
            delay_seconds = EXCLUDED.delay_seconds
    `, [
        stock.id, stock.guildId, stock.name, stock.emoji ?? null,
        stock.value, stock.initialValue,
        stock.categoryId, stock.categoryName, stock.delaySeconds,
    ]);
}

async function updateStockValue(id, value) {
    await pool.query('UPDATE stocks SET value = $1 WHERE id = $2', [value, id]);
}

function toStock(row) {
    return {
        id:           row.id,
        guildId:      row.guild_id,
        name:         row.name,
        emoji:        row.emoji ?? null,
        value:        parseFloat(row.value),
        initialValue: parseFloat(row.initial_value),
        categoryId:   row.category_id,
        categoryName: row.category_name,
        delaySeconds: parseInt(row.delay_seconds, 10),
    };
}

module.exports = { init, getStocks, upsertStock, updateStockValue };
