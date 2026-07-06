// ai_client.js — Groq呼び出し共通ヘルパー。429（レート制限）時はローカルOllamaにフォールバックする
const axios = require('axios');

const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

// model: Groq側のモデル名。messages/max_tokens/temperatureはGroq・Ollama両方に渡す。
// groqOnly: reasoning_effortなどGroq専用パラメータ（Ollamaには渡さない）。
async function chatCompletion({ model, messages, max_tokens, temperature, groqOnly = {}, timeout = 10000 }) {
    const body = {
        messages,
        ...(max_tokens  !== undefined && { max_tokens }),
        ...(temperature !== undefined && { temperature }),
    };

    try {
        const res = await axios.post(GROQ_URL, { model, ...body, ...groqOnly }, {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            timeout,
        });
        return res.data.choices[0].message.content.trim();
    } catch (e) {
        if (e.response?.status !== 429) throw e;
        console.warn('[AI] Groqレート制限(429) → ローカルOllama(qwen2.5:3b)にフォールバック');
        const res = await axios.post(OLLAMA_URL, { model: OLLAMA_MODEL, ...body }, { timeout });
        return res.data.choices[0].message.content.trim();
    }
}

module.exports = { chatCompletion };
