// kick_inactive.js — 2週間無活動メンバーのキック
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getLastActivity } = require('./activity_tracker');

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

const PROTECTED_ROLE_IDS = new Set([
    '1478715790575538359',
    '1491824502169145484',
]);

function getInactiveMembers(members) {
    const threshold = Date.now() - TWO_WEEKS_MS;

    return [...members.filter(m => {
        if (m.user.bot) return false;
        if (m.permissions.has('Administrator')) return false;
        if (m.id === m.guild.ownerId) return false;
        if ([...PROTECTED_ROLE_IDS].some(id => m.roles.cache.has(id))) return false;

        const last = getLastActivity(m.id);
        if (last === null) return (m.joinedTimestamp ?? 0) < threshold;
        return last < threshold;
    }).values()];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function makeLine(m, now) {
    const last = getLastActivity(m.id);
    if (last !== null) {
        const daysAgo = Math.floor((now - last) / DAY_MS);
        return `• <@${m.id}> — 最終発言 **${daysAgo}日前**`;
    }
    const joinedDaysAgo = Math.floor((now - (m.joinedTimestamp ?? now)) / DAY_MS);
    return `• <@${m.id}> — 発言記録なし（参加 ${joinedDaysAgo}日前）`;
}

async function handleKickInactive(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', flags: [MessageFlags.Ephemeral] });
    }

    const dryRun = interaction.options.getBoolean('dry_run') ?? true;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const members = await interaction.guild.members.fetch();
    const targets = getInactiveMembers(members);

    if (targets.length === 0) {
        return interaction.editReply('対象者がいません（全員2週間以内に活動あり）。');
    }

    const now = Date.now();

    if (dryRun) {
        // 発言記録なし vs 発言古い の2グループに分ける
        const noRecord  = targets.filter(m => getLastActivity(m.id) === null);
        const hasRecord = targets.filter(m => getLastActivity(m.id) !== null);

        const noRecordLines  = noRecord.map(m => makeLine(m, now));
        const hasRecordLines = hasRecord.map(m => makeLine(m, now));

        const allLines = [...hasRecordLines, ...noRecordLines];
        const preview  = allLines.slice(0, 25).join('\n') + (allLines.length > 25 ? `\n…他${allLines.length - 25}名` : '');

        const embed = new EmbedBuilder()
            .setTitle(`👢 キック対象プレビュー (全${targets.length}名)`)
            .setColor(0xFFA500)
            .addFields(
                { name: '最終発言が2週間超', value: `${hasRecord.length}名`, inline: true },
                { name: '発言記録なし',       value: `${noRecord.length}名`,  inline: true },
            )
            .setDescription(preview)
            .setFooter({ text: 'dry_run: false で実際にキック実行' })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    const lines = targets.map(m => makeLine(m, now));
    let kicked = 0;
    let failed = 0;

    for (const m of targets) {
        try {
            await m.kick('2週間無活動（自動キック）');
            kicked++;
        } catch {
            failed++;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('✅ キック完了')
        .setColor(kicked > 0 ? 0x57F287 : 0xED4245)
        .addFields(
            { name: '対象', value: `${targets.length}名`, inline: true },
            { name: '成功', value: `${kicked}名`,          inline: true },
            { name: '失敗', value: `${failed}名`,           inline: true },
        )
        .setDescription(lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n…他${lines.length - 20}名` : ''))
        .setTimestamp();

    console.log(`[KickInactive] ✅ ${kicked}名キック / ${failed}名失敗`);
    return interaction.editReply({ embeds: [embed] });
}

module.exports = { handleKickInactive };
