// engine_tts.js — VOICEVOX互換エンジン（COEIROINK/SHAREVOX/AivisSpeech等）のTTS取得
// これらは声優が演じたオリジナルキャラクターのフリー音声合成エンジンで、
// VOICEVOXと同じ audio_query → synthesis のHTTP APIを実装している。
// 運用者が自分でエンジン本体（ローカルまたは同一ネットワーク上）を起動し、
// そのURLを ENGINE_TTS_URL に設定することで利用できる。
const axios = require('axios');

const ENGINE_URL = process.env.ENGINE_TTS_URL || 'http://127.0.0.1:10101';
const MAX_TEXT_LENGTH = 100;

let speakerCache = null;
let speakerCacheAt = 0;
const SPEAKER_CACHE_MS = 5 * 60 * 1000;

// speakers一覧を取得し、{ label, styleId } のフラットな配列に整形してキャッシュする
async function listSpeakers() {
    const now = Date.now();
    if (speakerCache && now - speakerCacheAt < SPEAKER_CACHE_MS) return speakerCache;

    const res = await axios.get(`${ENGINE_URL}/speakers`, { timeout: 5_000 });
    const flat = [];
    for (const speaker of res.data || []) {
        for (const style of speaker.styles || []) {
            const label = style.name && style.name !== 'ノーマル'
                ? `${speaker.name}（${style.name}）`
                : speaker.name;
            flat.push({ label, styleId: style.id });
        }
    }
    speakerCache = flat;
    speakerCacheAt = now;
    return flat;
}

async function synthesize(text, styleId) {
    const trimmed = text.slice(0, MAX_TEXT_LENGTH);
    if (!trimmed.trim()) return null;

    const queryRes = await axios.post(
        `${ENGINE_URL}/audio_query`,
        null,
        { params: { text: trimmed, speaker: styleId }, timeout: 10_000 }
    );

    const synthRes = await axios.post(
        `${ENGINE_URL}/synthesis`,
        queryRes.data,
        { params: { speaker: styleId }, responseType: 'arraybuffer', timeout: 15_000 }
    );

    return Buffer.from(synthRes.data);
}

module.exports = { synthesize, listSpeakers, ENGINE_URL };
