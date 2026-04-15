// lurker.js — ROM専目覚まし
const cron = require('node-cron');
const axios = require('axios');
const { MessageFlags } = require('discord.js');
const { getLastActivity } = require('./activity_tracker');
const { getSettings } = require('./config');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const THREE_WEEKS_MS = 3 * 7 * 24 * 60 * 60 * 1000;
const SIX_WEEKS_MS   = 6 * 7 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS    = 6 * 60 * 60 * 1000;

// なりすまし候補（固定ユーザーID）
const IMPERSONATOR_IDS = new Set([
    '1096854565896323213',
    '1291500075327033458',
    '1474050297126064281',
    '1122087669598523423',
]);

// メンション除外ロールID
const EXCLUDE_ROLE_IDS = new Set([
    '1491824502169145484',
    '1477262864883515564',
    '1478715790575538359',
]);

const COOLDOWN_FILE = resolveDataPath('lurker_cooldown.json');
ensureDir(COOLDOWN_FILE);
let lastPosted = readJson(COOLDOWN_FILE, { ts: 0 }).ts;

const MEMBERS_TTL = 5 * 60 * 1000; // 5分キャッシュ
let membersCache   = null;
let membersCacheTs = 0;
async function fetchMembers(guild) {
    if (membersCache && Date.now() - membersCacheTs < MEMBERS_TTL) return membersCache;
    membersCache   = await guild.members.fetch();
    membersCacheTs = Date.now();
    return membersCache;
}
function saveCooldown() {
    lastPosted = Date.now();
    writeJson(COOLDOWN_FILE, { ts: lastPosted });
}

/* ===== AI メッセージ生成 ===== */
async function generateWakeupMessage(targets) {
    const longest = Math.max(...targets.map(m => {
        const last = getLastActivity(m.id);
        return last ? Date.now() - last : Date.now() - (m.joinedTimestamp ?? 0);
    }));
    const weeksAway = Math.round(longest / (7 * 24 * 60 * 60 * 1000));

    const jstHour = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
    ).getHours();
    const timeOfDay = jstHour >= 5 && jstHour < 12 ? '朝'
                    : jstHour >= 12 && jstHour < 18 ? '昼'
                    : '夜';

    const urgency = weeksAway >= 6
        ? `最長${weeksAway}週間も姿を見せていない。かなり切迫感がある。`
        : `最長${weeksAway}週間ほど活動がない。やんわり声かけ。`;

    const names = targets.map(m => m.displayName).join('、');

    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 120,
            messages: [
                {
                    role: 'system',
                    content:
                        'あなたはDiscordサーバーの一般メンバーです。' +
                        'しばらく姿を見せていないメンバーに声をかけるメッセージを1文で生成してください。' +
                        '絵文字を1〜2個使い、フレンドリーで自然な口調にしてください。' +
                        'メンション（@名前）は含めないでください。メッセージ本文だけ返してください。',
                },
                {
                    role: 'user',
                    content: `時間帯: ${timeOfDay}\n状況: ${urgency}\n対象メンバー名: ${names}`,
                },
            ],
        }, {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            timeout: 8000,
        });
        return res.data.choices[0].message.content.trim();
    } catch (e) {
        console.warn('[Lurker] AI生成失敗、フォールバック:', e.message);
        // フォールバック
        const fallbacks = {
            朝: 'おはようございます！久しぶりに顔出してみてね😊',
            昼: 'こんにちは〜！最近どうですか？😄',
            夜: 'こんばんは！お久しぶりです✨',
        };
        return fallbacks[timeOfDay];
    }
}

/* ===== ルーカー取得 ===== */
function getLurkers(members) {
    const threshold = Date.now() - THREE_WEEKS_MS;

    return [...members.filter(m => {
        if (m.user.bot) return false;
        if (m.permissions.has('Administrator')) return false;
        if ([...EXCLUDE_ROLE_IDS].some(id => m.roles.cache.has(id))) return false;
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

/* ===== なりすまし対象（固定IDから抽選）===== */
const webhookCache = new Map();

function getImpersonator(members) {
    const candidates = [...members.filter(m => IMPERSONATOR_IDS.has(m.id)).values()];
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
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

    const [channel, members] = await Promise.all([
        client.channels.fetch(channelId).catch(() => null),
        fetchMembers(guild),
    ]);
    if (!channel) return { skipped: true, reason: 'channel_not_found' };

    const lurkers = getLurkers(members);
    if (!lurkers.length) return { skipped: true, reason: 'no_lurkers' };

    const targets      = pickRandom(lurkers, 4, 7);
    const impersonator = getImpersonator(members);
    const mentions     = targets.map(m => `<@${m.id}>`).join(' ');

    const [message, wh] = await Promise.all([
        generateWakeupMessage(targets),
        getWebhook(channel, client),
    ]);
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
