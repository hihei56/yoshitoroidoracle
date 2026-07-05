// yoshiyoshi.js — 全肯定チャットBot（メンション返信）
// プライマリ: Gemini API（無料枠） / 429時フォールバック: ローカルOllama(qwen2.5:3b)
const axios = require('axios');

const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const OLLAMA_HOST    = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const TYPING_INTERVAL_MS = 8000;

const SYSTEM_PROMPT =
    'あなたは「よしよし」という名前の、ユーザーの発言をどんな内容でも絶対に否定せず全力で肯定し労うキャラクターです。' +
    '共感し、褒め、励ます返信を40〜60文字程度の日本語で1つだけ返してください。絵文字を1つ添えてください。' +
    '前置きや説明は不要で、返信本文だけを出力してください。';

async function askGemini(userText) {
    const res = await axios.post(GEMINI_URL, {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: 80 },
    }, {
        params:  { key: process.env.GEMINI_API_KEY },
        timeout: 8000,
    });
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini応答が空です');
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
        return await askGemini(userText);
    } catch (e) {
        console.warn('[Yoshiyoshi] Gemini失敗、Ollamaへフォールバック:', e.response?.status ?? e.message);
        try {
            return await askOllama(userText);
        } catch (e2) {
            console.warn('[Yoshiyoshi] Ollamaも失敗、固定文で返信:', e2.message);
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
