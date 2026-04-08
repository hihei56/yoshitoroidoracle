// deathmatch.js — Oracle Cloud対応版
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const ROLE_ONYANOKO  = '1477009108279365732';
const ROLE_KENKA     = '1477566044712210525';

const LOG_FILE = resolveDataPath('dice_logs.json');
ensureDir(LOG_FILE);

const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const getToday  = () => new Date().toLocaleDateString('ja-JP');

function loadLogs() {
    const logs = readJson(LOG_FILE, {});
    // 古いエントリを掃除（今日以外は削除）
    const today   = getToday();
    let changed   = false;
    for (const [id, date] of Object.entries(logs)) {
        if (date !== today) { delete logs[id]; changed = true; }
    }
    if (changed) writeJson(LOG_FILE, logs);
    return logs;
}

async function handleDeathmatch(interaction) {
    try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const challenger = interaction.member;
        const today      = getToday();
        const isAdmin    = challenger.permissions.has('Administrator');

        const logs = loadLogs();

        if (!isAdmin && logs[challenger.id] === today) {
            return interaction.editReply('本日の運試しは既に終了しています。');
        }

        // ダイス判定
        const diceIndex = Math.floor(Math.random() * 6);
        const diceIcon  = diceFaces[diceIndex];
        const isHit     = diceIndex === 0;

        await interaction.editReply(
            `運試しの結果: **${diceIcon}** ${isHit ? '…不穏な予感がします。' : '…平穏な一日のようです。'}`
        );

        if (isHit) {
            const allMembers     = await interaction.guild.members.fetch();
            const eligibleMembers = allMembers.filter(m => !m.user.bot && m.id !== challenger.id);

            if (eligibleMembers.size > 0) {
                const victim       = eligibleMembers.random();
                const isVictimRole = victim.roles.cache.has(ROLE_ONYANOKO) || victim.roles.cache.has(ROLE_KENKA);

                let timeoutMs = 60_000; // 一般：1分
                if (isVictimRole) {
                    timeoutMs = Math.floor(Math.random() * (2419200000 - 86400000 + 1)) + 86400000;
                }

                if (victim.moderatable) {
                    await victim.timeout(timeoutMs, '運試しダイスの巻き添え').catch(() => {});
                }

                const days  = Math.floor(timeoutMs / 86400000);
                const hours = Math.floor(timeoutMs / 3600000);

                const embed = new EmbedBuilder()
                    .setTitle('💀 判定：的中 (⚀)')
                    .setDescription(
                        `${victim} が本日の犠牲者として選ばれました。\n` +
                        `制限時間: **${days > 0 ? days + '日間' : hours + '時間'}**`
                    )
                    .setThumbnail(victim.user.displayAvatarURL({ size: 512 }))
                    .setColor(0xFF0000)
                    .setTimestamp();

                await interaction.channel.send({ embeds: [embed] }).catch(() => {});
            }
        }

        if (!isAdmin) {
            logs[challenger.id] = today;
            writeJson(LOG_FILE, logs);
        }

    } catch (e) {
        console.error('Dice Error:', e);
        if (interaction.deferred) await interaction.deleteReply().catch(() => {});
    }
}

module.exports = { handleDeathmatch };
