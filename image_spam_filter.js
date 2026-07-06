// image_spam_filter.js — 画像内テキストをOCRし、詐欺/スパム画像を検知して削除
// tutinoko2048/anti-image-spam の検知ルール(MIT)を参考に実装
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const { resolveDataPath } = require('./dataPath');

const SCORE_THRESHOLD = 200;

const CACHE_PATH = resolveDataPath('tesseract-cache');
fs.mkdirSync(CACHE_PATH, { recursive: true });

// 詐欺画像でよく使われる英語キーワード（言語を問わず英語で書かれることが多いため）
const RULES = [
    { type: 'gambling',   score: 50, patterns: [/\bcasino\b/, /\brakeback\b/, /\bjackpot\b/, /\bbet\b/] },
    { type: 'crypto',     score: 40, patterns: [/\bcrypto\b/, /\bcryptocurrency\b/, /\btoken\b/] },
    { type: 'giveaway',   score: 30, patterns: [/\bgiveaway\b/, /\bgiving away\b/, /\breward\b/, /\bbonus\b/, /\bpromo code\b/, /\bpromotion\b/] },
    { type: 'urgency',    score: 30, patterns: [/\blimited time\b/, /\bonly today\b/, /\bdeleted\b/, /\bdon't miss\b/, /\bfastest\b/] },
    { type: 'withdrawal', score: 20, patterns: [/\bwithdraw\b/, /\bwithdrawal successful\b/] },
    { type: 'celebrity',  score: 30, patterns: [/\bmrbeast\b/, /\b@mrbeast\b/, /\bbeast games\b/, /\bdonaldtrump\b/, /\bdonald j\.? trump\b/] },
];

function scoreText(text) {
    const lower = text.toLowerCase();
    let score = 0;
    const matched = new Set();

    for (const rule of RULES) {
        if (rule.patterns.some(p => p.test(lower))) {
            score += rule.score;
            matched.add(rule.type);
        }
    }

    // 「有名人＋詐欺誘因」の組み合わせは特に危険なので加点
    if (matched.has('celebrity') && matched.has('crypto'))   score += 50;
    if (matched.has('celebrity') && matched.has('gambling')) score += 50;
    if (matched.has('celebrity') && matched.has('giveaway')) score += 50;

    return score;
}

let workerPromise = null;
function getWorker() {
    if (!workerPromise) {
        workerPromise = createWorker('eng', undefined, { cachePath: CACHE_PATH });
    }
    return workerPromise;
}

async function checkImageAttachments(message) {
    try {
        if (message.author.bot || !message.guild) return;

        const imageAttachments = [...message.attachments.values()]
            .filter(a => a.contentType?.startsWith('image/'));
        if (imageAttachments.length === 0) return;

        const worker = await getWorker();

        let totalScore = 0;
        for (const att of imageAttachments) {
            try {
                const { data: { text } } = await worker.recognize(att.url);
                totalScore += scoreText(text);
            } catch (e) {
                console.error('[ImageSpam] OCRエラー:', e.message);
            }
        }

        if (totalScore < SCORE_THRESHOLD) return;

        console.warn(`[ImageSpam] 検知: ${message.author.tag} score=${totalScore}`);

        if (message.deletable) await message.delete().catch(() => {});
    } catch (e) {
        console.error('[ImageSpam] 処理エラー:', e);
    }
}

module.exports = { checkImageAttachments };
