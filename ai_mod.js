// ai_mod.js — AI/画像モデレーション + ファイルダウンロード
const axios  = require('axios');
const { OpenAI } = require('openai');

let _openai = null;
function getOpenAI() {
    if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openai;
}

const DL_CONFIG = { MAX_FILES: 7, MAX_SIZE: 8 * 1024 * 1024, TIMEOUT: 4_000 };

async function downloadFiles(attachments) {
    const files = [];
    for (const att of [...attachments.values()].slice(0, DL_CONFIG.MAX_FILES)) {
        if (att.size > DL_CONFIG.MAX_SIZE) continue;
        try {
            const res = await axios.get(att.url, {
                responseType: 'arraybuffer',
                timeout: DL_CONFIG.TIMEOUT,
            });
            files.push({ attachment: Buffer.from(res.data), name: att.name || 'file' });
        } catch {}
    }
    return files;
}

const AI_THRESHOLDS = {
    'sexual/minors':            0.20,
    'hate':                     0.60,
    'hate/threatening':         0.55,
    'harassment':               0.80,
    'harassment/threatening':   0.70,
    'self-harm':                0.70,
    'self-harm/intent':         0.55,
    'self-harm/instructions':   0.45,
    'sexual':                   0.90,
    'violence':                 0.88,
    'violence/graphic':         0.80,
};

async function checkAiModeration(text) {
    if (!text?.trim() || !process.env.OPENAI_API_KEY) return { flagged: false, reason: null };
    try {
        const result = await getOpenAI().moderations.create({
            model: 'omni-moderation-latest',
            input: text,
        });
        const scores = result.results[0]?.category_scores ?? {};
        for (const [cat, threshold] of Object.entries(AI_THRESHOLDS)) {
            if ((scores[cat] ?? 0) > threshold) {
                return { flagged: true, reason: cat };
            }
        }
        return { flagged: false, reason: null };
    } catch (e) {
        console.error('[AI Mod] API失敗:', e.message);
        return { flagged: false, reason: null };
    }
}

const NSFW_IMAGE_THRESHOLDS = {
    'sexual':         0.70,
    'sexual/minors':  0.10,
};

async function checkNsfwImages(attachments) {
    if (!process.env.OPENAI_API_KEY) return { nsfw: false, reason: null };
    const imageAtts = [...attachments.values()].filter(a =>
        a.contentType?.startsWith('image/') && a.size <= DL_CONFIG.MAX_SIZE
    );
    if (imageAtts.length === 0) return { nsfw: false, reason: null };

    const inputItems = imageAtts.map(att => ({
        type: 'image_url',
        image_url: { url: att.url },
    }));

    try {
        const result = await getOpenAI().moderations.create({
            model: 'omni-moderation-latest',
            input: inputItems,
        });
        const scores = result.results[0]?.category_scores ?? {};
        for (const [cat, threshold] of Object.entries(NSFW_IMAGE_THRESHOLDS)) {
            if ((scores[cat] ?? 0) > threshold) {
                return { nsfw: true, reason: cat };
            }
        }
        return { nsfw: false, reason: null };
    } catch (e) {
        console.error('[NSFW Img] API失敗:', e.message);
        return { nsfw: false, reason: null };
    }
}

module.exports = { DL_CONFIG, downloadFiles, checkAiModeration, checkNsfwImages };
