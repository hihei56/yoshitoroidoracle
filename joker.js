// joker.js
const { EmbedBuilder, MessageFlags } = require('discord.js');

const ROLE_JAKUSHA  = '1476944370694488134'; // 実行権限 & 免除
const ROLE_RAIHIN   = '1478715790575538359'; // 免除
const ALLOWED_CHANNEL = '1476939503510884638'; // このチャンネルでのみ実行可能

async function handleJoker(interaction) {
    try {
        // ====================================
        // 0. チャンネル制限
        // ====================================
        if (interaction.channelId !== ALLOWED_CHANNEL) {
            return interaction.reply({
                content: '🤡 このコマンドは指定チャンネルでしか使えないよぉ🤥',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.deferReply(); // 全員に見える（誰がやったか明確に）

        const challenger = interaction.member;
        const channel    = interaction.channel;

        // 実行権限チェック
        if (!challenger.roles.cache.has(ROLE_JAKUSHA)) {
            return interaction.editReply('🤡「弱者男性」以外がジョーカーを語るなよぉ🤥💢');
        }

        // ====================================
        // 免除対象以外のメンバー取得
        // ====================================
        const allMembers = await interaction.guild.members.fetch();
        const candidates = allMembers.filter(m => {
            if (m.user.bot)                        return false;
            if (m.id === challenger.id)            return false;
            if (m.roles.cache.has(ROLE_JAKUSHA))   return false;
            if (m.roles.cache.has(ROLE_RAIHIN))    return false;
            return true;
        });

        if (candidates.size === 0) {
            return interaction.editReply('ターゲットが見つからないよぉ🤥');
        }

        const roll = Math.random();

        // ====================================
        // 🎲 90%: 自分がタイムアウト
        // ====================================
        if (roll < 0.9) {
            const selfTimeoutMs = Math.floor(Math.random() * (28 * 86400000 - 60000 + 1)) + 60000;
            const formatted     = formatDuration(selfTimeoutMs);

            if (challenger.moderatable) {
                await challenger.timeout(selfTimeoutMs, 'JOKER: BACKFIRE').catch(() => {});
            }

            const embed = new EmbedBuilder()
                .setTitle('🤡💥 JOKER: BACKFIRE')
                .setDescription(
                    `**<@${challenger.id}> が引き金を引いた。**\n\n` +
                    `銃口は自分に向いていた。\n\n` +
                    `🔒 拘束時間: **${formatted}**`
                )
                .setImage(challenger.user.displayAvatarURL({ dynamic: true, size: 512 }))
                .setColor(0x2B2D31)
                .setFooter({ text: '9割がこれ。それでもやるか？🤡' })
                .setTimestamp();

            return interaction.editReply({
                content: `<@${challenger.id}>`,
                embeds:  [embed],
                allowedMentions: { users: [challenger.id] },
            });
        }

        // ====================================
        // 🎯 10%: 全員大量タイムアウト
        // ====================================
        const results  = [];
        const shuffled = candidates.toJSON().sort(() => Math.random() - 0.5);

        for (const victim of shuffled) {
            const timeoutMs = Math.floor(Math.random() * (28 * 86400000 - 86400000 + 1)) + 86400000;
            const formatted = formatDuration(timeoutMs);

            if (victim.moderatable) {
                await victim.timeout(timeoutMs, `JOKER: MASS PURGE by ${challenger.user.tag}`).catch(() => {});
                results.push(`・<@${victim.id}> — ${formatted}`);
            } else {
                results.push(`・<@${victim.id}> — 権限不足により回避`);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('🤡🔪 JOKER: MASS REAPING')
            .setDescription(
                `**<@${challenger.id}> が引き金を引いた。**\n\n` +
                `今日は当たりだった。全員道連れだ。\n\n` +
                `**粛清リスト:**\n${results.join('\n')}`
            )
            .setImage(challenger.user.displayAvatarURL({ dynamic: true, size: 512 }))
            .setColor(0xFF0000)
            .setFooter({ text: '確率10%。お前は引いた。🤡' })
            .setTimestamp();

        const mentions = shuffled.filter(m => m.moderatable).map(m => m.id);

        await interaction.editReply({
            content: [challenger.toString(), ...mentions.map(id => `<@${id}>`)].join(' '),
            embeds:  [embed],
            allowedMentions: { users: [challenger.id, ...mentions] },
        });

    } catch (e) {
        console.error('Joker Error:', e);
        await interaction.editReply('システムエラーだ。運が良かったな🤥').catch(() => {});
    }
}

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const days     = Math.floor(totalSec / 86400);
    const hours    = Math.floor((totalSec % 86400) / 3600);
    const minutes  = Math.floor((totalSec % 3600) / 60);
    const parts    = [];
    if (days)    parts.push(`${days}日`);
    if (hours)   parts.push(`${hours}時間`);
    if (minutes) parts.push(`${minutes}分`);
    return parts.join(' ') || '間もなく解除';
}

module.exports = { handleJoker };
