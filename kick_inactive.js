// kick_inactive.js — 2週間無活動メンバーのキック
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getLastActivity } = require('./activity_tracker');

const TWO_WEEKS_MS     = 14 * 24 * 60 * 60 * 1000;
const KICK_BATCH_LIMIT = 10;   // 1回の実行で最大キック人数
const KICK_INTERVAL_MS = 3000; // キック間隔（ミリ秒）

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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function handleKickInactive(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', flags: [MessageFlags.Ephemeral] });
    }

    const dryRun = interaction.options.getBoolean('dry_run') ?? true;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const members = await interaction.guild.members.fetch();
    const targets = getInactiveMembers(members);

    if (targets.length === 0) {
        return interaction.editReply('対象者がいません（2週間以内に活動ありの人のみ）。');
    }

    const now = Date.now();
    const makeLine = m => {
        const last = getLastActivity(m.id);
        const daysAgo = last
            ? Math.floor((now - last) / (24 * 60 * 60 * 1000))
            : Math.floor((now - (m.joinedTimestamp ?? now)) / (24 * 60 * 60 * 1000));
        return `• <@${m.id}> — ${daysAgo}日間無活動`;
    };

    const remaining = targets.length - KICK_BATCH_LIMIT;

    if (dryRun) {
        const lines = targets.map(makeLine);
        const embed = new EmbedBuilder()
            .setTitle(`👢 キック対象プレビュー (全${targets.length}名)`)
            .setColor(0xFFA500)
            .setDescription(lines.slice(0, 30).join('\n') + (lines.length > 30 ? `\n他${lines.length - 30}名…` : ''))
            .setFooter({ text: `dry_run: false で実行（1回${KICK_BATCH_LIMIT}名・${KICK_INTERVAL_MS / 1000}秒間隔）` })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    // 1回の実行はKICK_BATCH_LIMIT名まで
    const batch = targets.slice(0, KICK_BATCH_LIMIT);
    const lines = batch.map(makeLine);

    let kicked = 0;
    let failed = 0;

    for (const m of batch) {
        try {
            await m.kick('2週間無活動（自動キック）');
            kicked++;
        } catch {
            failed++;
        }
        await sleep(KICK_INTERVAL_MS);
    }

    const footerText = remaining > 0
        ? `残り${remaining}名います。再度コマンドを実行してください。`
        : '全員キック完了。';

    const embed = new EmbedBuilder()
        .setTitle('✅ キック完了')
        .setColor(kicked > 0 ? 0x57F287 : 0xED4245)
        .addFields(
            { name: '今回の対象', value: `${batch.length}名`,  inline: true },
            { name: '成功',       value: `${kicked}名`,         inline: true },
            { name: '失敗',       value: `${failed}名`,         inline: true },
        )
        .setDescription(lines.join('\n'))
        .setFooter({ text: footerText })
        .setTimestamp();

    console.log(`[KickInactive] ✅ ${kicked}名キック / ${failed}名失敗 / 残り${Math.max(0, remaining)}名`);
    return interaction.editReply({ embeds: [embed] });
}

module.exports = { handleKickInactive };
