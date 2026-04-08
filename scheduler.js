// scheduler.js — Oracle Cloud対応版
const cron   = require('node-cron');
const axios  = require('axios');
const Parser = require('rss-parser');
const parser = new Parser();
const { EmbedBuilder } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

// データパス（Oracle: DATA_DIR/posted_news.json）
const POSTED_LOG_PATH = resolveDataPath('posted_news.json');
ensureDir(POSTED_LOG_PATH);

const webhookCache = new Map();

const CONFIG = {
    TOMO_AVATAR_URL:   'https://emojis.wiki/thumbs/emojis/lying-face.webp',
    ATTACK_CHANNEL_ID: '1476939503510884638',

    FEEDS: [
        { url: 'https://feeds.gizmodo.jp/rss/gizmodo',              genre: 'ガジェット', emoji: '📱', color: 0x00B4D8 },
        { url: 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml', genre: 'テック',     emoji: '💻', color: 0x0077B6 },
        { url: 'https://feed.rss20.jp/rss/pc_watch',                genre: 'PC',         emoji: '🖥️', color: 0x023E8A },
        { url: 'https://annict.com/anime.rss',                      genre: 'アニメ',     emoji: '🎌', color: 0xFF6B6B },
        { url: 'https://akiba-souken.com/rss/',                     genre: 'アキバ系',   emoji: '🏮', color: 0xFF4D6D },
        { url: 'https://seiyuanime.com/feed/',                      genre: '声優',       emoji: '🎙️', color: 0xF72585 },
        { url: 'https://www.famitsu.com/rss/feed_news.rdf',         genre: 'ゲーム',     emoji: '🎮', color: 0x7B2FBE },
        { url: 'https://jp.ign.com/feed.xml',                       genre: 'ゲーム',     emoji: '🕹️', color: 0x6A0DAD },
        { url: 'https://nijisanji.jp/news/rss.xml',                 genre: 'VTuber',     emoji: '🌸', color: 0xFF85A1 },
        { url: 'https://hololive.hololivepro.com/feed',             genre: 'VTuber',     emoji: '🎤', color: 0x4CC9F0 },
        { url: 'https://blog.livedoor.jp/dqnplus/index.rdf',        genre: '話題',       emoji: '🔥', color: 0xFB5607 },
        { url: 'https://alfalfalfa.com/index.rdf',                  genre: 'まとめ',     emoji: '📣', color: 0xFF9E00 },
    ],
};

/* =========================
   📋 投稿済みURL管理
========================= */
function getPostedUrls() {
    return readJson(POSTED_LOG_PATH, []);
}

function savePostedUrl(url) {
    const urls = getPostedUrls();
    if (urls.includes(url)) return;
    urls.push(url);
    if (urls.length > 200) urls.splice(0, urls.length - 200);
    writeJson(POSTED_LOG_PATH, urls);
}

/* =========================
   🤖 ジャンル別プロンプト
========================= */
function buildPrompt(genre) {
    const base  = 'あなたはニュース解説の「ともちゃん」です。';
    const rules = {
        '声優':   '声優・アニメ界隈のニュースを、ファン目線で親しみやすく2〜3行で解説してください。結婚・引退などセンシティブな話題は事実を淡々と伝えてください。',
        'VTuber': 'VTuber関連のニュースを、界隈に詳しいファン目線で2〜3行で解説してください。',
        'ゲーム': 'ゲームニュースを、ゲーマー目線で2〜3行で解説してください。発売日・価格・注目点を含めてください。',
        'ガジェット': 'ガジェット・テックニュースを、スペックや価格など実用的な観点で2〜3行で解説してください。',
        'まとめ': '話題になっている内容を中立的に2〜3行でまとめてください。',
    };
    return `${base}\n${rules[genre] ?? 'ニュースを中立的に2〜3行で分かりやすく解説してください。'}`;
}

/* =========================
   📍 Webhook取得
========================= */
async function getWebhook(channel) {
    if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
    try {
        const webhooks = await channel.fetchWebhooks();
        let wh = webhooks.find(w => w.token);
        if (!wh) wh = await channel.createWebhook({ name: 'ともちゃん', avatar: CONFIG.TOMO_AVATAR_URL });
        webhookCache.set(channel.id, wh);
        return wh;
    } catch (e) {
        console.error('[Scheduler] Webhook Error:', e.message);
        return null;
    }
}

/* =========================
   📰 ニュース送信
========================= */
async function sendTomoNews(client) {
    try {
        if (Math.random() > 0.5) return; // 50%でスキップ

        const channel    = await client.channels.fetch(CONFIG.ATTACK_CHANNEL_ID);
        const postedUrls = getPostedUrls();

        // シャッフルして毎回違うジャンルから選ぶ
        const feeds = [...CONFIG.FEEDS].sort(() => Math.random() - 0.5);
        let targetItem = null;
        let targetFeed = null;

        for (const feed of feeds) {
            try {
                const response = await axios.get(feed.url, {
                    timeout: 8_000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TomoBot/1.0)' },
                });
                const parsed = await parser.parseString(response.data);
                const item   = parsed.items.find(i => i.link && !postedUrls.includes(i.link));
                if (item) { targetItem = item; targetFeed = feed; break; }
            } catch { continue; }
        }

        if (!targetItem || !targetFeed) return;

        const contentSnippet = (targetItem.contentSnippet || targetItem.content || '')
            .replace(/<[^>]*>/g, '')
            .substring(0, 300);

        // AI解説
        let aiText = '詳細はリンク先をご確認ください。';
        try {
            const res = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model:      'llama-3.3-70b-versatile',
                    max_tokens: 200,
                    messages: [
                        { role: 'system', content: buildPrompt(targetFeed.genre) },
                        { role: 'user',   content: `【タイトル】${targetItem.title}\n【内容】${contentSnippet}` },
                    ],
                },
                {
                    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
                    timeout: 15_000,
                }
            );
            aiText = res.data.choices[0].message.content.trim();
        } catch (e) {
            console.error('[Scheduler] Groq Error:', e.message);
        }

        const embed = new EmbedBuilder()
            .setTitle(targetItem.title.substring(0, 50))
            .setURL(targetItem.link)
            .setDescription(aiText)
            .setColor(0x2B2D31);

        const webhook = await getWebhook(channel);
        const payload = {
            embeds:    [embed],
            username:  'ともちゃんニュース通信',
            avatarURL: CONFIG.TOMO_AVATAR_URL,
        };

        if (webhook) await webhook.send(payload);
        else         await channel.send({ embeds: [embed] });

        savePostedUrl(targetItem.link);
        console.log(`[Scheduler] 投稿: [${targetFeed.genre}] ${targetItem.title}`);

    } catch (e) {
        console.error('[Scheduler] News Error:', e.message);
    }
}

/* =========================
   ⏰ スケジューラ初期化
========================= */
function initScheduler(client) {
    console.log(`[Scheduler] ✅ 初期化完了 | データ: ${POSTED_LOG_PATH}`);

    // 9時・15時・21時（JST）
    ['0 9 * * *', '0 15 * * *', '0 21 * * *'].forEach(expr => {
        cron.schedule(expr, () => sendTomoNews(client), { timezone: 'Asia/Tokyo' });
    });

    if (process.env.DEBUG_MODE === 'true') {
        setTimeout(() => sendTomoNews(client), 3_000);
    }
}

module.exports = { initScheduler };
