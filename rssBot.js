const Parser = require('rss-parser');
const { WebhookClient, EmbedBuilder } = require('discord.js');
const he = require('he');
const { OpenAI } = require('openai');
const fs = require('fs');

const parser = new Parser({ timeout: 5000 });

// ===== OpenAI (Groq) =====
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

// ===== Webhook =====
const UNTAI = new WebhookClient({ url: process.env.UNTAI_WEBHOOK });
const AI_WEBHOOKS = [
    new WebhookClient({ url: process.env.AI_WEBHOOK1 }),
    new WebhookClient({ url: process.env.AI_WEBHOOK2 }),
    new WebhookClient({ url: process.env.AI_WEBHOOK3 })
];

// ===== RSS =====
const RSS_URLS = [
    "https://nitter.net/electlone/rss",
    "https://nitter.tiekoetter.com/electlone/rss",
    "https://nitter.poast.org/electlone/rss"
];

// ===== 永続化 =====
const SEEN_LINKS_FILE = process.env.FLY_APP_NAME
    ? '/data/seen_links.json'
    : './seen_links.json';

let seenLinks = [];
try {
    if (fs.existsSync(SEEN_LINKS_FILE)) {
        seenLinks = JSON.parse(fs.readFileSync(SEEN_LINKS_FILE, 'utf8'));
    }
} catch {
    seenLinks = [];
}

function saveSeenLinks() {
    try {
        if (seenLinks.length > 100) {
            seenLinks = seenLinks.slice(-100);
        }
        fs.writeFileSync(SEEN_LINKS_FILE, JSON.stringify(seenLinks, null, 2));
    } catch (e) {
        console.error("保存失敗:", e.message);
    }
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
                {
                    role: "system",
                    content: "投稿に対して軽い分析や皮肉を1文で返してください。"
                },
                { role: "user", content: text }
            ],
            max_tokens: 60
        });

        return res.choices[0].message.content.trim();

    } catch (e) {
        console.error("AI失敗:", e.message);
        return null;
    }
}

// ===== 投稿 =====
async function postTweet(item, client) {
    let raw = he.decode(item.contentSnippet || item.title || "");
    const imageUrl = findImageUrl(item);

    // URL削除
    const quoteRegex = /https?:\/\/(?:twitter\.com|x\.com)\/\S+/g;
    const quotes = raw.match(quoteRegex);

    let quoteBlock = "";
    if (quotes) {
        quotes.forEach(url => raw = raw.replace(url, ""));
        quoteBlock = `\n\n> 🔁 引用\n> ${quotes[quotes.length - 1]}`;
    }

    raw = raw.replace(/https:\/\/t\.co\/\w+/g, "").trim();

    const embed = new EmbedBuilder()
        .setColor('#1DA1F2')
        .setAuthor({ name: "electlone", url: "https://x.com/electlone" })
        .setTitle("🔗 Xで見る")
        .setURL(item.link)
        .setFooter({ text: "不対電子研究所" });

    if (item.isoDate) embed.setTimestamp(new Date(item.isoDate));

    try {
        const msg = await UNTAI.send({
            content: raw + quoteBlock,
            embeds: [embed],
            files: imageUrl ? [{ attachment: imageUrl }] : [],
            username: "不対電子",
            fetchReply: true
        });

        if (!client) return;

        const channel = await client.channels.fetch(msg.channel_id);
        const message = await channel.messages.fetch(msg.id);

        // ===== スレッド =====
        const thread = await message.startThread({
            name: "💬 コメント欄",
            autoArchiveDuration: 60
        });

        // ===== AI返信 =====
        const reply = await generateAIReply(raw);

        if (reply) {
            const aiWebhook =
                AI_WEBHOOKS[Math.floor(Math.random() * AI_WEBHOOKS.length)];

            await aiWebhook.send({
                content: reply,
                threadId: thread.id
            });
        }

        console.log("✅ 投稿成功");

        seenLinks.push(item.link);
        saveSeenLinks();

    } catch (e) {
        console.error("投稿失敗:", e.message);
    }
}

// ===== RSS取得 =====
let lastFail = 0;
let lastSuccessURL = null;

async function checkRSS(client) {
    const now = Date.now();

    // クールダウン
    if (now - lastFail < 5 * 60 * 1000) {
        console.log("⏸ クールダウン中");
        return;
    }

    let feed = null;

    // 成功したURL優先
    const urls = lastSuccessURL
        ? [lastSuccessURL, ...RSS_URLS.filter(u => u !== lastSuccessURL)]
        : RSS_URLS;

    for (const url of urls) {
        try {
            feed = await parser.parseURL(url);
            lastSuccessURL = url;
            console.log("✅ RSS成功:", url);
            break;
        } catch {
            console.log("❌ RSS失敗:", url);
        }
    }

    if (!feed) {
        lastFail = now;
        console.log("💀 全RSS死亡");
        return;
    }

    const candidates = feed.items.filter(i =>
        !seenLinks.includes(i.link) &&
        (i.contentSnippet?.length || i.title?.length || 0) > 30
    );

    if (!candidates.length) return;

    await postTweet(candidates[0], client);
}

module.exports = { checkRSS };