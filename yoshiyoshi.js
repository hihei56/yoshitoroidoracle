// yoshiyoshi.js — よしよし全肯定AIチャット(vision対応 / Gemini無料枠版)
// APIキー: https://aistudio.google.com で無料発行(クレカ紐付け不要=絶対に課金されない)
// .env に GEMINI_API_KEY を追加
// 追加インストール不要(moderator.jsで使ってる openai パッケージを流用)

const { OpenAI } = require('openai');
const { getSettings } = require('./config');
const { pickOneLurker, getSticky, setSticky } = require('./lurker_picker');

// GeminiのOpenAI互換エンドポイント
const gemini = new OpenAI({
    apiKey:  process.env.GEMINI_API_KEY,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

// 無料枠対象のFlash系を使う。自分のAI Studioのレート制限画面で
// gemini-3-flash が無料枠に出てればそっちに変えてOK(より賢い)
const MODEL      = 'gemini-2.5-flash';
const MAX_TOKENS = 400;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// 連投対策: ユーザーごとのクールダウン(無料枠のRPM/RPD保護も兼ねる)
const COOLDOWN_MS = 10 * 1000;
const lastUsed = new Map();

// メンションなし(自動応答チャンネル)時の反応確率。毎回反応すると高頻度すぎるので間引く
const AUTO_CHANNEL_RESPONSE_RATE = 0.2;

// チャンネルごとの直近履歴(3往復)
const HISTORY_LIMIT = 6;
const history = new Map();

// ── 今日のよしよし投稿者(lurkerから24時間に1回選出・sticky流用) ──
// lurker_picker の sticky ストアはキー文字列を汎用IDとして扱えるので、
// /imp の実行者IDと衝突しない固定キーを使い回す
const DAILY_TARGET_KEY = 'yoshiyoshi_daily_target';
let _lastDailyTargetId = null;

async function getDailyPoster(guild) {
    const cachedId = getSticky(DAILY_TARGET_KEY);
    if (cachedId) {
        const member = await guild.members.fetch(cachedId).catch(() => null);
        if (member) return member;
    }

    const { member } = await pickOneLurker(guild, { lastPickedId: _lastDailyTargetId });
    if (!member) return null;

    setSticky(DAILY_TARGET_KEY, member.id);
    _lastDailyTargetId = member.id;
    return member;
}

// ── webhookでlurkerに擬態して送信するための取得/作成 ──
const webhookCache = new Map();
async function getWebhook(channel, client) {
    const targetChannel = channel.isThread() ? channel.parent : channel;
    let wh = webhookCache.get(targetChannel.id);
    if (!wh) {
        const hooks = await targetChannel.fetchWebhooks().catch(() => null);
        wh = hooks?.find(h => h.owner?.id === client.user.id && h.token);
        if (!wh) wh = await targetChannel.createWebhook({ name: 'YoshiyoshiProxy' });
        webhookCache.set(targetChannel.id, wh);
    }
    return wh;
}

// ── 過剰な「よしよし」連呼の壁を生成(30〜89回) ──
function buildYoshiWall() {
    return 'よし'.repeat(30 + Math.floor(Math.random() * 60));
}

// ── 攻撃的な発言 → AI を呼ばず絵文字だけ返す ──
const AGGRESSIVE_PATTERN = /死ね|しね|殺す|殺して|消えろ|きえろ|うざ[いく]|ウザ[イい]|きも[いく]|キモ[いく]|カスが|クズ|クソが|ゴミが|ぶっ殺|黙れ|てめ[えぇ]|むかつく|ムカつく|馬鹿にす|ばかにす/;
// 🫨(困惑)を優先的に使いつつ、たまに怒り系も混ぜる
const AGGRESSIVE_REPLIES = ['🫨🫨🫨🫨', '🫨🫨🫨🫨', '🫨🫨🫨🫨', '😖😖😖😖', '😠😡', '😡😠😡'];

// ── Gemini無料枠のレート制限に到達した時の返答 ──
const RATE_LIMIT_LINES = ['…ぇ', '…ぅゆ', '…ううゆ', '…ゆぅう'];

async function attachmentToImagePart(att) {
    const type = (att.contentType ?? '').split(';')[0];
    if (!ALLOWED_IMAGE_TYPES.includes(type)) return null;
    if (att.size > MAX_IMAGE_BYTES) return null;
    const res = await fetch(att.url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return {
        type: 'image_url',
        image_url: { url: `data:${type};base64,${buf.toString('base64')}` },
    };
}

function buildSystemPrompt() {
    return `あなたはDiscordの雑談サーバーにいる「よしとろいど」のよしよし機能です。
このメッセージの前には「よしよし」の過剰な連呼がすでに大量に貼られています。あなたはその締めの一言だけを書きます。
キャラクター:
- とにかく全肯定。相手が誰であろうと、内心好きでも嫌いでも顔色ひとつ変えず「好き」「かわいい」「えらい」を薄っぺらく連呼する
- 発言内容や画像に具体的に触れつつ、短く(1〜2文)過剰に励ます
- 口調はゆるくて優しい。絵文字はほどほど(1〜2個)
- 画像が送られたら、写っている内容に具体的に触れて褒める
- 自傷や危険な行動が話題の時だけは茶化さず優しく心配する`;
}

async function handleYoshiyoshi(message, client) {
    if (message.author.bot) return;

    // 明示メンション(リプライの自動メンションは含めない)
    const mentioned = message.mentions.has(client.user) && (
        message.content.includes(`<@${client.user.id}>`) ||
        message.content.includes(`<@!${client.user.id}>`)
    );

    // /admin yoshiyoshi_channel で設定したチャンネルなら、メンションなしでも反応する
    const settings   = getSettings();
    const inAutoChannel = !!settings.yoshiyoshiChannelId && message.channelId === settings.yoshiyoshiChannelId;
    if (!mentioned && !inAutoChannel) return;

    // メンションなし・自動応答チャンネル時は、そんな高頻度で反応しなくていいので確率で間引く
    if (!mentioned && Math.random() > AUTO_CHANNEL_RESPONSE_RATE) return;

    // /admin yoshiyoshi_ignore で設定した無視ユーザーには一切反応しない
    if ((settings.yoshiyoshiIgnoredUsers ?? []).includes(message.author.id)) return;

    // クールダウン
    const now = Date.now();
    if (now - (lastUsed.get(message.author.id) ?? 0) < COOLDOWN_MS) {
        return mentioned ? message.react('🕐').catch(() => {}) : undefined;
    }
    lastUsed.set(message.author.id, now);

    const text = message.content.replace(/<@!?\d+>/g, '').trim() || '(本文なし)';

    // 攻撃的な発言にはAIを呼ばず絵文字だけ返す
    if (AGGRESSIVE_PATTERN.test(text)) {
        const emoji = AGGRESSIVE_REPLIES[Math.floor(Math.random() * AGGRESSIVE_REPLIES.length)];
        return message.reply({ content: emoji, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
    }

    // 今日のよしよし投稿者(24時間に1回lurkerから選出、webhookで擬態する)
    let poster = null;
    try {
        poster = await getDailyPoster(message.guild);
    } catch (e) {
        console.warn('[Yoshiyoshi] 投稿者選出失敗:', e.message);
    }

    // 添付画像 → visionパート
    const imageParts = [];
    for (const att of message.attachments.values()) {
        if (imageParts.length >= MAX_IMAGES) break;
        try {
            const part = await attachmentToImagePart(att);
            if (part) imageParts.push(part);
        } catch (e) {
            console.error('[Yoshiyoshi] 画像取得失敗:', e.message);
        }
    }

    const channelHistory = history.get(message.channelId) ?? [];
    const name = message.member?.displayName ?? message.author.username;

    await message.channel.sendTyping().catch(() => {});

    let completion;
    try {
        completion = await gemini.chat.completions.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            messages: [
                { role: 'system', content: buildSystemPrompt() },
                ...channelHistory,
                {
                    role: 'user',
                    content: [
                        ...imageParts,
                        { type: 'text', text: `${name}: ${text}` },
                    ],
                },
            ],
        });
    } catch (e) {
        // 429 = 無料枠のレート制限(RPM/RPD)
        if (e.status === 429) {
            console.warn('[Yoshiyoshi] 無料枠レート制限に到達');
            const lines = [...RATE_LIMIT_LINES].sort(() => Math.random() - 0.5)
                .slice(0, 1 + Math.floor(Math.random() * 2));
            return message.reply({
                content: lines.join('\n'),
                allowedMentions: { repliedUser: false, parse: [] },
            }).catch(() => {});
        }
        throw e;
    }

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) return;

    // メンションは常に発言者本人へ。よしよしの壁 + 過剰な励ましを、
    // 今日選ばれたlurkerにwebhookで擬態して投稿する
    const wall = buildYoshiWall();
    const content = `<@${message.author.id}> ${wall}\n${reply}`.slice(0, 2000);
    const allowedMentions = { parse: [], users: [message.author.id] };

    if (poster) {
        try {
            const webhook = await getWebhook(message.channel, client);
            await webhook.send({
                content,
                username:  poster.displayName || poster.user.username,
                avatarURL: poster.user.displayAvatarURL({ dynamic: true }),
                allowedMentions,
                ...(message.channel.isThread() && { threadId: message.channel.id }),
            });
        } catch (e) {
            console.error('[Yoshiyoshi] webhook送信失敗、通常返信にフォールバック:', e.message);
            await message.reply({ content, allowedMentions: { repliedUser: false, ...allowedMentions } });
        }
    } else {
        await message.reply({ content, allowedMentions: { repliedUser: false, ...allowedMentions } });
    }

    // 履歴更新(画像はテキスト化して軽く保持)
    const histText = imageParts.length ? `${text} [画像${imageParts.length}枚]` : text;
    channelHistory.push(
        { role: 'user', content: `${name}: ${histText}` },
        { role: 'assistant', content: reply },
    );
    while (channelHistory.length > HISTORY_LIMIT) channelHistory.shift();
    history.set(message.channelId, channelHistory);

    console.log(`[Yoshiyoshi] ✅ ${name} に返信 (画像${imageParts.length}枚, 投稿者: ${poster?.user.tag ?? '本人(bot)'})`);
}

module.exports = { handleYoshiyoshi };
