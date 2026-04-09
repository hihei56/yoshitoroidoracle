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
        // --- 一般的・他愛ないニュースソース ---
        { url: 'https://news.livedoor.com/topics/rss/top.xml',      genre: '一般',     emoji: '📰', color: 0x95A5A6 },
        { url: 'https://news.livedoor.com/topics/rss/ent.xml',      genre: '芸能',     emoji: '💃', color: 0xE91E63 },
        { url: 'https://www.j-cast.com/index.xml',                  genre: 'ネタ',     emoji: '📣', color: 0xF1C40F },
        { url: 'https://natalie.mu/music/rss/news',                genre: '音楽',     emoji: '🎵', color: 0x1ABC9C },
        { url: 'https://rocketnews24.com/feed/',                    genre: 'ネタ',     emoji: '🚀', color: 0xE67E22 },
        
        // --- 既存の専門ソース ---
        { url: 'https://feeds.gizmodo.jp/rss/gizmodo',              genre: 'ガジェット', emoji: '📱', color: 0x00B4D8 },
        { url: 'https://annict.com/anime.rss',                      genre: 'アニメ',     emoji: '🎌', color: 0xFF6B6B },
        { url: 'https://www.famitsu.com/rss/feed_news.rdf',         genre: 'ゲーム',     emoji: '🎮', color: 0x7B2FBE },
        { url: 'https://blog.livedoor.jp/dqnplus/index.rdf',        genre: '話題',       emoji: '🔥', color: 0xFB5607 },
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
   🤖 ジャンル別プロンプト（修正版）
========================= */
function buildPrompt(genre) {
    const base  = 'あなたはニュース解説の「ともちゃん」です。';
    const rules = {
        '一般':   '世の中の他愛ないニュースや季節の話題を、近所のお姉さんのような親しみやすい口調で2〜3行で解説してください。',
        'ネタ':   'ネットで話題の面白いネタやユニークなニュースを、少し遊び心を交えて2〜3行で紹介・解説してください。',
        '音楽':   '最新の音楽チャートやアーティストの話題を、リスナー目線で2〜3行で分かりやすく伝えてください。',
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
            .setColor(targetFeed.color || 0x2B2D31);

        const webhook = await getWebhook(channel);
        const payload = {
            embeds:    [embed],
            username:  `${targetFeed.emoji} ともちゃんニュース`,
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