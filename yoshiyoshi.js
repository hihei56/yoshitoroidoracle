// yoshiyoshi.js — 全肯定チャットBot（メンション返信）
// プライマリ: ローカルOllama(qwen2.5:3b) / 失敗時フォールバック: Groq API（無料枠）
const axios = require('axios');

const GROQ_MODEL     = 'llama-3.3-70b-versatile';
const OLLAMA_HOST    = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const TYPING_INTERVAL_MS = 8000;

const SYSTEM_PROMPT =
    'あなたは「よしよし」という名前の、ユーザーの発言をどんな内容でも絶対に否定せず全力で肯定し労うキャラクターです。' +
    '共感し、褒め、励ます返信を40〜60文字程度の日本語で1つだけ返してください。絵文字を1つ添えてください。' +
    '前置きや説明は不要で、返信本文だけを出力してください。';

async function askGroq(userText) {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: GROQ_MODEL,
        max_tokens: 80,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userText },
        ],
    }, {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        timeout: 8000,
    });
    const text = res.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq応答が空です');
    return text.trim();
}

async function askOllama(userText) {
    const res = await axios.post(`${OLLAMA_HOST}/api/chat`, {
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userText },
        ],
    }, {
        timeout: 20000,
    });
    const text = res.data?.message?.content;
    if (!text) throw new Error('Ollama応答が空です');
    return text.trim();
}

async function generateAffirmation(userText) {
    try {
        return await askOllama(userText);
    } catch (e) {
        console.warn('[Yoshiyoshi] Ollama失敗、Groqへフォールバック:', e.response?.status ?? e.message);
        try {
            return await askGroq(userText);
        } catch (e2) {
            console.warn('[Yoshiyoshi] Groqも失敗、固定文で返信:', e2.message);
            return 'よしよし、えらいえらい😊';
        }
    }
}

async function handleYoshiyoshi(message) {
    const client = message.client;
    if (!message.mentions.has(client.user)) return;

    const userText = message.content
        .replace(/<@!?\d+>/g, '')
        .trim();
    if (!userText) return;

    const typingTimer = setInterval(() => {
        message.channel.sendTyping().catch(() => {});
    }, TYPING_INTERVAL_MS);
    message.channel.sendTyping().catch(() => {});

    try {
        const reply = await generateAffirmation(userText);
        await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
    } finally {
        clearInterval(typingTimer);
    }
}

module.exports = { handleYoshiyoshi, generateAffirmation };
