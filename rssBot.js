const Parser = require('rss-parser');
const cron = require('node-cron');
const { WebhookClient, EmbedBuilder } = require('discord.js');
const he = require('he');
const { OpenAI } = require('openai');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const rssParser = new Parser({ timeout: 10000 });

// ===== OpenAI (Groq) =====
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

// ===== Webhook =====
const UNTAI_WEBHOOK = new WebhookClient({ url: process.env.UNTAI_WEBHOOK });
const AI_WEBHOOKS = [
    new WebhookClient({ url: process.env.AI_WEBHOOK1 }),
    new WebhookClient({ url: process.env.AI_WEBHOOK2 }),
    new WebhookClient({ url: process.env.AI_WEBHOOK3 })
];

// ===== Fly RSS =====
const RSS_URL = "https://rssproxy.fly.dev/rss";

// ===== 永続化 =====
const SEEN_LINKS_FILE = resolveDataPath('seen_links.json');
ensureDir(SEEN_LINKS_FILE);

let seenLinks = readJson(SEEN_LINKS_FILE, []);

function saveSeenLinks() {
    if (seenLinks.length > 200) seenLinks = seenLinks.slice(-200);
    writeJson(SEEN_LINKS_FILE, seenLinks);
}

// ===== URL変換 =====
function convertToTwitterUrl(url) {
    if (!url) return url;
    return url
        .replace("nitter.net", "x.com")
        .replace("nitter.tiekoetter.com", "x.com")
        .replace("nitter.poast.org", "x.com");
}

// ===== 画像取得 =====
function findImageUrl(item) {
    if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
        return item.enclosure.url;
    }
    const html = item.content || item.contentSnippet;
    if (html) {
        const match = html.match(/<img[^>]+src="([^">]+)"/);
        if (match) return match[1];
    }
    return null;
}

// ===== AI返信 =====
async function generateAIReply(text) {
    try {
        const res = await openai.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "投稿に対して軽い分析や皮肉を1文で返してください。" },
                { role: "user", content: text }
            ],
            max_tokens: 60
        });
        return res.choices[0].message.content.trim();
    } catch (e) {
        console.error("[RSS] AI返信失敗:", e.message);
        return null;
    }
}

// ===== 投稿 =====
async function postTweet(item, client) {
    let raw = he.decode(item.contentSnippet || item.title || "");
    const imageUrl  = findImageUrl(item);
    const tweetUrl  = convertToTwitterUrl(item.link);

    const quoteRegex = /https?:\/\/(?:twitter\.com|x\.com)\/\S+/g;
    const quotes     = raw.match(quoteRegex);
    let quoteBlock   = "";
    if (quotes) {
        quotes.forEach(url => { raw = raw.replace(url, ""); });
        quoteBlock = `\n\n> 🔁 引用\n> ${quotes[quotes.length - 1]}`;
    }
    raw = raw.replace(/https:\/\/t\.co\/\w+/g, "").trim();

    const embed = new EmbedBuilder()
        .setColor('#1DA1F2')
        .setAuthor({ name: "electlone", url: "https://x.com/electlone" })
        .setTitle("🔗 Xで見る")
        .setURL(tweetUrl)
        .setFooter({ text: "不対電子研究所" });

    if (item.isoDate) embed.setTimestamp(new Date(item.isoDate));

    let msg;
    try {
        msg = await UNTAI_WEBHOOK.send({
            content:    raw + quoteBlock,
            embeds:     [embed],
            files:      imageUrl ? [{ attachment: imageUrl }] : [],
            username:   "不対電子",
            fetchReply: true,
        });
    } catch (e) {
        console.error("[RSS] 投稿失敗:", e.message);
        return;
    }

    // 投稿成功 → 即座にseenLinksを更新（スレッド失敗でも重複投稿を防ぐ）
    seenLinks.push(item.link);
    saveSeenLinks();
    console.log("[RSS] ✅ 投稿成功:", (item.title ?? '').slice(0, 50));

    if (!client) return;

    // スレッド + AI返信（失敗しても投稿は成功扱い）
    try {
        const channel = await client.channels.fetch(msg.channel_id);
        const message = await channel.messages.fetch(msg.id);
        const thread  = await message.startThread({
            name:               "💬 コメント欄",
            autoArchiveDuration: 60,
        });

        const reply = await generateAIReply(raw);
        if (reply) {
            const aiWebhook = AI_WEBHOOKS[Math.floor(Math.random() * AI_WEBHOOKS.length)];
            await aiWebhook.send({ content: reply, threadId: thread.id });
        }
    } catch (e) {
        console.warn("[RSS] スレッド/AI返信失敗（投稿自体は成功）:", e.message);
    }
}

// ===== RSS取得・チェック =====
async function checkRSS(client) {
    let feed;
    try {
        feed = await rssParser.parseURL(RSS_URL);
    } catch (e) {
        console.error("[RSS] フィード取得失敗:", e.message);
        return;
    }

    // 未投稿アイテムを抽出（内容が空のものだけ除外）
    const candidates = feed.items.filter(i =>
        !seenLinks.includes(i.link) &&
        (i.contentSnippet || i.title || "").trim().length > 0
    );

    console.log(`[RSS] フィード${feed.items.length}件 / 未投稿${candidates.length}件 / 既読${seenLinks.length}件`);

    if (!candidates.length) return;

    await postTweet(candidates[0], client);
}

// ===== cron初期化（index.jsから呼ぶ）=====
function initRSS(client) {
    console.log("[RSS] ✅ 初期化 | 30分毎にチェック");
    // 毎時0分・30分
    cron.schedule('*/30 * * * *', () => checkRSS(client), { timezone: 'Asia/Tokyo' });
    // 起動時に即チェック
    checkRSS(client);
}

module.exports = { initRSS, checkRSS };
