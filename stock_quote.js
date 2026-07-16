// stock_quote.js — stooq.comから日本株の直近終値を取得する（無料・APIキー不要）
// スパム役キャラがごく稀に見せる「真剣な投資トーク」の小ネタ用
const axios = require('axios');

// スパム役が好む値動きの荒い銘柄（信用買い・投機的な短期売買のネタ元）
const TICKERS = [
    { code: '6740.jp', name: 'JDI（ジャパンディスプレイ）' },
    { code: '285a.jp', name: 'キオクシア' },
];

async function fetchQuote(code) {
    try {
        const res = await axios.get('https://stooq.com/q/l/', {
            params: { s: code, f: 'sd2t2ohlcv', h: '', e: 'csv' },
            timeout: 8_000,
        });
        const lines = String(res.data).trim().split('\n');
        if (lines.length < 2) return null;

        // ヘッダ: Symbol,Date,Time,Open,High,Low,Close,Volume
        const cols  = lines[1].split(',');
        const date  = cols[1];
        const close = parseFloat(cols[6]);
        if (!Number.isFinite(close) || close <= 0) return null; // 銘柄未対応(N/D)など

        return { date, close };
    } catch (e) {
        console.error(`[StockQuote] 取得エラー(${code}):`, e.message);
        return null;
    }
}

// TICKERSからランダムな順に試し、最初に取得できた銘柄の終値を返す。全滅ならnull
async function fetchRandomQuote() {
    const shuffled = [...TICKERS].sort(() => Math.random() - 0.5);
    for (const ticker of shuffled) {
        const quote = await fetchQuote(ticker.code);
        if (quote) return { ...quote, name: ticker.name };
    }
    return null;
}

module.exports = { fetchRandomQuote };
