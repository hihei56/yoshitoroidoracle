// animal_image.js — 動物画像API経由でランダムな画像URLを取得する（無料・APIキー不要）
const axios = require('axios');

const SOURCES = [
    { name: 'dog',  url: 'https://dog.ceo/api/breeds/image/random', extract: d => d?.message },
    { name: 'cat',  url: 'https://api.thecatapi.com/v1/images/search', extract: d => d?.[0]?.url },
    { name: 'fox',  url: 'https://randomfox.ca/floof/', extract: d => d?.image },
    { name: 'duck', url: 'https://random-d.uk/api/v2/random', extract: d => d?.url },
];

async function fetchOne(source) {
    try {
        const res = await axios.get(source.url, { timeout: 8_000 });
        const url = source.extract(res.data);
        return url ? { url, source: source.name } : null;
    } catch (e) {
        console.error(`[AnimalImage] 取得エラー(${source.name}):`, e.message);
        return null;
    }
}

// SOURCESからランダムな順に試し、最初に取得できた画像URLを返す。全滅ならnull
async function fetchRandomAnimalImage() {
    const shuffled = [...SOURCES].sort(() => Math.random() - 0.5);
    for (const source of shuffled) {
        const result = await fetchOne(source);
        if (result) return result;
    }
    return null;
}

module.exports = { fetchRandomAnimalImage };
