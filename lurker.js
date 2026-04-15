// lurker.js — ROM専目覚まし
const cron = require('node-cron');
const { MessageFlags } = require('discord.js');
const { getLastActivity } = require('./activity_tracker');
const { getSettings } = require('./config');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const THREE_WEEKS_MS = 3 * 7 * 24 * 60 * 60 * 1000;
const SIX_WEEKS_MS   = 6 * 7 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS    = 6 * 60 * 60 * 1000; // 手動実行の連投防止

const COOLDOWN_FILE = resolveDataPath('lurker_cooldown.json');
ensureDir(COOLDOWN_FILE);
let lastPosted = readJson(COOLDOWN_FILE, { ts: 0 }).ts;
function saveCooldown() {
    lastPosted = Date.now();
    writeJson(COOLDOWN_FILE, { ts: lastPosted });
}

/* ===== メッセージバリエーション ===== */
const MSG_MORNING = [
    'みなさま、おはようございます〜😊',
    'おはよ〜！！今日も元気出していこ！😄',
    'おはようございます✨ 最近どうですか？',
    'おはようございます！久しぶりに顔出してみてね〜😊',
];
const MSG_AFTERNOON = [
    'みなさん、こんにちは〜！😊',
    'こんにちは〜✨ 最近どうですか？',
    'こんにちは！久しぶりに話しかけてみてね😄',
];
const MSG_EVENING = [
    'みなさん、こんばんは〜😊',
    'こんばんは！今日も一日お疲れ様でした✨',
    'こんばんは〜😊 ゆっくりしていってね',
];
// 6週間以上未活動の人向け（30%で使用）
const MSG_URGENT = [
    '生存確認〜！！最近全然見かけないですが元気にしてますか？😅',
    'ちょっとちょっと！久しぶりすぎない？😂',
    '遭難してない？？心配してたよ〜😂',
    'ご無沙汰すぎます！まだ生きてますか〜？😅',
    '久しぶり！アカウント乗っ取られてない？笑',
];

function pickMessage(targets) {
    // 最長未活動メンバーで切迫度を判断
    const longest = Math.max(...targets.map(m => {
        const last = getLastActivity(m.id);
        return last ? Date.now() - last : Date.now() - (m.joinedTimestamp ?? 0);
    }));

    if (longest > SIX_WEEKS_MS && Math.random() < 0.30) {
        return MSG_URGENT[Math.floor(Math.random() * MSG_URGENT.length)];
    }

    // JSTで時刻判定
    const jstHour = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
    ).getHours();
    const pool = jstHour >= 5 && jstHour < 12 ? MSG_MORNING
               : jstHour >= 12 && jstHour < 18 ? MSG_AFTERNOON
               : MSG_EVENING;
    return pool[Math.floor(Math.random() * pool.length)];
}

/* ===== ルーカー取得 ===== */
async function getLurkers(guild) {
    const members = await guild.members.fetch();
    const threshold = Date.now() - THREE_WEEKS_MS;

    return [...members.filter(m => {
        if (m.user.bot) return false;
        if (m.permissions.has('Administrator')) return false;
        const last = getLastActivity(m.id);
        // 活動記録なし → 参加から3週間以上経過していればルーカー扱い
        if (last === null) return (m.joinedTimestamp ?? 0) < threshold;
        return last < threshold;
    }).values()];
}

function pickRandom(arr, min, max) {
    const count = Math.min(arr.length, Math.floor(Math.random() * (max - min + 1)) + min);
    return [...arr].sort(() => Math.random() - 0.5).slice(0, count);
}

/* ===== なりすまし対象（最近アクティブな一般ユーザー）===== */
const webhookCache = new Map();

async function getImpersonator(guild) {
    const members = await guild.members.fetch();
    const threshold = Date.now() - THREE_WEEKS_MS;
    const active = [...members.filter(m => {
        if (m.user.bot) return false;
        if (m.permissions.has('Administrator')) return false;
        const last = getLastActivity(m.id);
        return last && last >= threshold;
    }).values()];
    if (!active.length) return null;
    return active[Math.floor(Math.random() * active.length)];
}

async function getWebhook(channel, client) {
    if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
    const hooks = await channel.fetchWebhooks();
    let wh = hooks.find(h => h.owner?.id === client.user.id && h.token);
    if (!wh) wh = await channel.createWebhook({ name: 'LurkerWake' });
    webhookCache.set(channel.id, wh);
    return wh;
}

/* ===== メイン投稿 ===== */
async function postWakeup(client, guild, channelId, force = false) {
    if (!force && Date.now() - lastPosted < COOLDOWN_MS) {
        return { skipped: true, reason: 'cooldown' };
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return { skipped: true, reason: 'channel_not_found' };

    const lurkers = await getLurkers(guild);
    if (!lurkers.length) return { skipped: true, reason: 'no_lurkers' };

    const targets     = pickRandom(lurkers, 4, 7);
    const impersonator = await getImpersonator(guild);
    const mentions    = targets.map(m => `<@${m.id}>`).join(' ');
    const message     = pickMessage(targets);

    const wh       = await getWebhook(channel, client);
    const username  = impersonator?.displayName ?? 'フレンドリーなユーザー';
    const avatarURL = impersonator?.user.displayAvatarURL({ dynamic: true }) ?? undefined;

    await wh.send({ content: `${mentions}\n${message}`, username, avatarURL });
    saveCooldown();

    console.log(`[Lurker] ✅ ${targets.length}名起こした: ${targets.map(m => m.user.tag).join(', ')} (成りすまし: ${username})`);
    return { success: true, count: targets.length, impersonator: username };
}

/* ===== コマンドハンドラ ===== */
async function handleLurker(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', flags: [MessageFlags.Ephemeral] });
    }

    const settings   = getSettings();
    const chOption   = interaction.options.getChannel('channel');
    const channelId  = chOption?.id ?? settings.lurkerChannelId;
    const force      = interaction.options.getBoolean('force') ?? false;

    if (!channelId) {
        return interaction.reply({
            content: 'チャンネルを指定するか、`/admin lurker_channel` で設定してください。',
            flags: [MessageFlags.Ephemeral],
        });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const result = await postWakeup(interaction.client, interaction.guild, channelId, force);

    if (result.skipped) {
        const msg = result.reason === 'cooldown'
            ? '⏳ クールダウン中（6時間）。`force: true` で強制実行できます。'
            : result.reason === 'no_lurkers' ? '対象者がいません（3週間以内に活動ありの人のみ）。'
            : `失敗: ${result.reason}`;
        return interaction.editReply(msg);
    }

    await interaction.editReply(
        `✅ ${result.count}名に送信しました\n成りすまし: **${result.impersonator}**`
    );
}

/* ===== cron初期化 ===== */
function initLurker(client) {
    const settings = getSettings();
    if (!settings.lurkerChannelId) {
        console.log('[Lurker] チャンネル未設定。自動投稿は無効。');
        return;
    }
    // 毎朝8時 JST
    cron.schedule('0 8 * * *', async () => {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        await postWakeup(client, guild, settings.lurkerChannelId);
    }, { timezone: 'Asia/Tokyo' });

    console.log('[Lurker] ✅ 初期化 | 毎朝8時に自動投稿');
}

module.exports = { initLurker, handleLurker };
