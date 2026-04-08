// rssBot.js — Oracle Cloud対応版
const Parser = require('rss-parser');
const { WebhookClient, EmbedBuilder } = require('discord.js');
const he     = require('he');
const { OpenAI } = require('openai');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const openai = new OpenAI({
    apiKey:  process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const parser = new Parser();

const UNTAI = new WebhookClient({ url: process.env.UNTAI_WEBHOOK });
const AI_WEBHOOKS = [
    new WebhookClient({ url: process.env.AI_WEBHOOK1 }),
    new WebhookClient({ url: process.env.AI_WEBHOOK2 }),
    new WebhookClient({ url: process.env.AI_WEBHOOK3 }),
];

const RSS_URLS = [
    'https://nitter.net/electlone/rss',
    'https://nitter.tiekoetter.com/electlone/rss',
    'https://nitter.poast.org/electlone/rss',
];

// データパス（Oracle: DATA_DIR/seen_links.json）
const SEEN_LINKS_FILE = resolveDataPath('seen_links.json');
ensureDir(SEEN_LINKS_FILE);

let seenLinks = readJson(SEEN_LINKS_FILE, []);
console.log(`[RSS] seen_links 読み込み: ${seenLinks.length}件 (${SEEN_LINKS_FILE})`);

function saveSeenLinks() {
    if (seenLinks.length > 50) seenLinks = seenLinks.slice(-50);
    writeJson(SEEN_LINKS_FILE, seenLinks);
}

function findImageUrl(item) {
    if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) return item.enclosure.url;
    const html = item.content || item.contentSnippet;
    if (html) {
        const match = html.match(/<img[^>]+src="([^">]+)"/);
        if (match) return match[1];
    }
    return null;
}

async function generateAIReply(text) {
    try {
        const res = await openai.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: '投稿内容に対して、軽い批評や分析をする一言コメントを返してください。断定しすぎず、少し距離を置いた視点で（1〜2文）' },
                { role: 'user',   content: text },
            ],
            max_tokens: 80,
        });
        return res.choices[0].message.content.trim();
    } catch (e) {
        console.error('[RSS] AI返信失敗:', e.message);
        return null;
    }
}

async function postTweet(item, client) {
    let raw      = he.decode(item.contentSnippet || item.title || '');
    const imageUrl = findImageUrl(item);

    const quoteRegex = /https?:\/\/(?:twitter\.com|x\.com)\/\S+/g;
    const quotes     = raw.match(quoteRegex);
    let quoteBlock   = '';
    if (quotes) {
        quotes.forEach(url => (raw = raw.replace(url, '')));
        quoteBlock = `\n\n> 🔁 引用\n> ${quotes[quotes.length - 1]}`;
    }
    raw = raw.replace(/https:\/\/t\.co\/\w+/g, '').trim();

    const embed = new EmbedBuilder()
        .setColor('#1DA1F2')
        .setAuthor({ name: 'electlone', url: 'https://x.com/electlone' })
        .setTitle('🔗 Xで見る')
        .setURL(item.link)
        .setFooter({ text: '不対電子研究所' });
    if (item.isoDate) embed.setTimestamp(new Date(item.isoDate));

    try {
        const msg = await UNTAI.send({
            content:    raw + quoteBlock,
            embeds:     [embed],
            files:      imageUrl ? [imageUrl] : [],
            username:   '不対電子',
            fetchReply: true,
        });

        if (!client) return;

        const channel = await client.channels.fetch(msg.channel_id);
        const message = await channel.messages.fetch(msg.id);
        const thread  = await message.startThread({ name: '💬 コメント欄', autoArchiveDuration: 60 });

        const reply = await generateAIReply(raw);
        if (reply?.length > 0) {
            const aiWebhook = AI_WEBHOOKS[Math.floor(Math.random() * AI_WEBHOOKS.length)];
            await aiWebhook.send({ content: reply, threadId: thread.id });
        }

        console.log('[RSS] ✅ 投稿 + AI返信完了');
        seenLinks.push(item.link);
        saveSeenLinks();
    } catch (e) {
        console.error('[RSS] 投稿失敗:', e.message);
    }
}

let lastFail = 0;

async function checkRSS(client) {
    const now = Date.now();
    if (now - lastFail < 5 * 60 * 1000) {
        console.log('[RSS] ⏸ クールダウン中');
        return;
    }

    let feed = null;
    for (const url of RSS_URLS) {
        try {
            feed = await parser.parseURL(url);
            console.log('[RSS] ✅ 取得成功:', url);
            break;
        } catch {
            console.log('[RSS] ❌ 失敗:', url);
        }
    }

    if (!feed) {
        lastFail = now;
        console.log('[RSS] 💀 全URL失敗');
        return;
    }

    const candidates = feed.items.filter(
        i => !seenLinks.includes(i.link) && (i.contentSnippet?.length || i.title?.length || 0) > 30
    );
    if (!candidates.length) return;

    await postTweet(candidates[0], client);
}

module.exports = { checkRSS };
