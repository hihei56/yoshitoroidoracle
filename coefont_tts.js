// coefont_tts.js — CoeFont公認ボイス（ひろゆき/岡田斗司夫）のTTS取得
// 正式なvoice生成APIはPlusプラン(月5.5万円)が必要なため、CoeFont公式サイトの
// 体験デモ（おしゃべりひろゆきメーカー/おしゃべり岡田斗司夫メーカー）が使う
// 非公開エンドポイントを利用する。予告なく変更・停止されうる点に留意。
const axios = require('axios');

// どちらもCoeFontが本人らと正式に提携して公開した公認の合成音声（無断クローンではない）
const VOICE_IDS = {
    hiroyuki: '19d55439-312d-4a1d-a27b-28f0f31bedc5',
    toshio:   '317cb032-bff5-46c5-8b69-c5953eac3ddd',
};

const MAX_TEXT_LENGTH = 100;

async function synthesize(text, voice) {
    const coefontId = VOICE_IDS[voice];
    if (!coefontId) throw new Error(`未対応のvoiceです: ${voice}`);

    const trimmed = text.slice(0, MAX_TEXT_LENGTH);
    if (!trimmed.trim()) return null;

    const postRes = await axios.post(
        `https://backend.coefont.cloud/coefonts/${coefontId}/try`,
        { variant: 'maker-tts-v2', text: trimmed },
        { timeout: 15_000 }
    );

    const wavUrl = postRes.data?.location;
    if (!wavUrl) return null;

    const wavRes = await axios.get(wavUrl, { responseType: 'arraybuffer', timeout: 15_000 });
    return Buffer.from(wavRes.data);
}

module.exports = { synthesize, VOICE_IDS };
