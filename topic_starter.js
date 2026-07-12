// topic_starter.js — 過疎対策: 毎日決まった時間に会話のお題を自動投稿
const cron = require('node-cron');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getSettings } = require('./config');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const POST_HOUR_JST = 20; // 毎日20:00(JST)に投稿

const HISTORY_FILE = resolveDataPath('topic_history.json');
ensureDir(HISTORY_FILE);
let history = readJson(HISTORY_FILE, { lastTopic: null });

function saveHistory() {
    writeJson(HISTORY_FILE, history);
}

const FALLBACK_TOPICS = [
    '最近ハマってるものある？',
    '今までで一番美味しかった食べ物は？',
    'もし1週間仕事も学校も休みだったら何する？',
    '最近見た中で一番良かった映画かアニメは？',
    '朝型？夜型？',
    '子供の頃の将来の夢は何だった？',
    '今一番欲しいものは？',
    '好きな季節とその理由は？',
    '最近笑ったことは？',
    'コンビニで必ず買っちゃうものある？',
    '無人島に1つだけ持っていけるなら何持ってく？',
    '最近やってるゲームある？',
    '休日の過ごし方は派？インドア派？アウトドア派？',
    '人生で一番驚いた出来事は？',
    '好きな音楽ジャンルは？',
    'もし超能力が1つ使えるなら何がいい？',
    '最近買ってよかったものある？',
    '得意料理ある？',
    '今年やり残したことある？',
    'ペット飼うなら何飼いたい？',
];

function pickFallbackTopic(lastTopic) {
    const candidates = FALLBACK_TOPICS.filter(t => t !== lastTopic);
    const pool = candidates.length ? candidates : FALLBACK_TOPICS;
    return pool[Math.floor(Math.random() * pool.length)];
}

async function generateTopic(lastTopic) {
    if (!process.env.GROQ_API_KEY) return pickFallbackTopic(lastTopic);
    try {
        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                max_tokens: 80,
                temperature: 1.0,
                messages: [
                    {
                        role: 'system',
                        content: 'あなたはDiscordサーバーの雑談チャンネルに「今日のお題」を出すMCです。' +
                            '政治・宗教・炎上しやすい話題は避け、誰でも気軽に答えられるカジュアルな話題や質問を1つだけ日本語で考えてください。' +
                            '20〜40文字程度、説明や前置きは付けず、お題本文だけを返してください。',
                    },
                    {
                        role: 'user',
                        content: lastTopic ? `直近のお題（重複回避）: ${lastTopic}` : 'お題を1つ出してください。',
                    },
                ],
            },
            { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 10_000 }
        );
        const text = res.data.choices[0]?.message?.content?.trim();
        if (!text) return pickFallbackTopic(lastTopic);

        const { hit } = checkNgWords(normalizeForDetection(text));
        if (hit) {
            console.warn('[TopicStarter] AI生成お題がNGワードに抵触、フォールバック使用');
            return pickFallbackTopic(lastTopic);
        }
        return text;
    } catch (e) {
        console.error('[TopicStarter] AI生成失敗、フォールバック:', e.message);
        return pickFallbackTopic(lastTopic);
    }
}

async function postTopic(client) {
    try {
        const settings  = getSettings();
        const channelId = settings.chatterChannelId ?? settings.lurkerChannelId;
        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const topic = await generateTopic(history.lastTopic);
        history.lastTopic = topic;
        saveHistory();

        const embed = new EmbedBuilder()
            .setTitle('💭 今日のお題')
            .setDescription(topic)
            .setColor(0x57F287)
            .setTimestamp();

        await channel.send({ embeds: [embed] });
        console.log(`[TopicStarter] ✅ 投稿: "${topic}"`);
    } catch (e) {
        console.error('[TopicStarter] エラー:', e.message);
    }
}

function initTopicStarter(client) {
    cron.schedule(`0 ${POST_HOUR_JST} * * *`, () => postTopic(client), { timezone: 'Asia/Tokyo' });
    console.log(`[TopicStarter] ✅ 初期化 | 毎日${POST_HOUR_JST}時: 会話のお題を自動投稿`);
}

module.exports = { initTopicStarter };
