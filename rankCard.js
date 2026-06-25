// rankCard.js — sharp + SVG でランクカード画像を生成
const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');
const { resolveDataPath, ensureDir } = require('./dataPath');
const { XP_PER_LEVEL, getLevelBadge } = require('./xp');

const BG_DIR = resolveDataPath('backgrounds');
ensureDir(path.join(BG_DIR, '.keep'));

const W = 800, H = 220;

function toHex(colorInt) {
    return '#' + colorInt.toString(16).padStart(6, '0');
}

async function fetchBuf(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function circleAvatar(buf, size = 160) {
    const mask = Buffer.from(
        `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></svg>`
    );
    return sharp(buf)
        .resize(size, size)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

function uiSvg(level, xp, levelBase, accent) {
    const current  = Math.max(0, xp - (levelBase ?? xp));
    const progress = Math.min(current / XP_PER_LEVEL, 1);
    // バー: アバター右から右端まで
    const bX = 220, bY = 150, bW = 550, bH = 24;
    const filled = Math.round(bW * progress);

    // レベルを示す四角いブロック（テキスト不使用）
    const blockSize = 60;
    const blockX = 225, blockY = 60;

    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bar" x1="0" y1="0" x2="${bW}" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="${accent}"/>
                <stop offset="100%" stop-color="${accent}33"/>
            </linearGradient>
        </defs>
        <!-- 左アクセントライン -->
        <rect x="0" y="0" width="6" height="${H}" fill="${accent}" rx="3"/>
        <!-- バー背景 -->
        <rect x="${bX}" y="${bY}" width="${bW}" height="${bH}" rx="${bH/2}" fill="#ffffff15"/>
        <!-- バー -->
        ${filled > 0 ? `<rect x="${bX}" y="${bY}" width="${filled}" height="${bH}" rx="${bH/2}" fill="url(#bar)"/>` : ''}
        <!-- バー内グロー -->
        ${filled > 4 ? `<rect x="${bX+2}" y="${bY+4}" width="${Math.max(0,filled-4)}" height="${bH/2-4}" rx="${bH/4}" fill="${accent}55"/>` : ''}
    </svg>`;
}

async function generateRankCard(userData, user, rank) {
    const { level, xp, levelBase, bgUrl } = userData;
    const badge  = getLevelBadge(level);
    const accent = toHex(badge.color);

    // ── ベース背景 ────────────────────────────────────────────────────
    const gradSvg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="g" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#0d0d1a"/>
                <stop offset="100%" stop-color="#1a0d30"/>
            </linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#g)" rx="16"/>
    </svg>`);

    let base;
    if (bgUrl) {
        try {
            // カスタム背景（ローカルファイルまたはURL）
            const isLocal = bgUrl.startsWith('/');
            const rawBuf  = isLocal ? fs.readFileSync(bgUrl) : await fetchBuf(bgUrl);
            const roundMask = Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="16"/></svg>`);
            const resized   = await sharp(rawBuf).resize(W, H, { fit: 'cover' }).png().toBuffer();
            const rounded   = await sharp(resized).composite([{ input: roundMask, blend: 'dest-in' }]).png().toBuffer();
            const overlay   = Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#00000099" rx="16"/></svg>`);
            base = await sharp(rounded).composite([{ input: overlay }]).png().toBuffer();
        } catch {
            base = await sharp(gradSvg).png().toBuffer();
        }
    } else {
        base = await sharp(gradSvg).png().toBuffer();
    }

    // ── レイヤー合成 ──────────────────────────────────────────────────
    const layers = [{ input: Buffer.from(uiSvg(level, xp, levelBase, accent)), left: 0, top: 0 }];

    try {
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
        const avatarBuf = await fetchBuf(avatarUrl);
        const circle    = await circleAvatar(avatarBuf, 160);
        layers.push({ input: circle, left: 35, top: 30 });
    } catch { /* アバター取得失敗は無視 */ }

    return sharp(base).composite(layers).png().toBuffer();
}

/** ユーザーのカスタム背景をローカルに保存し、パスを返す */
async function saveBgFromUrl(userId, url) {
    const buf     = await fetchBuf(url);
    // 画像として読めるか検証
    await sharp(buf).metadata();
    const outPath = path.join(BG_DIR, `${userId}.png`);
    await sharp(buf).resize(W, H, { fit: 'cover' }).png().toFile(outPath);
    return outPath;
}

async function saveBgFromAttachment(userId, attachmentUrl) {
    return saveBgFromUrl(userId, attachmentUrl);
}

function deleteBg(userId) {
    const p = path.join(BG_DIR, `${userId}.png`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
}

function getBgPath(userId) {
    const p = path.join(BG_DIR, `${userId}.png`);
    return fs.existsSync(p) ? p : null;
}

module.exports = { generateRankCard, saveBgFromUrl, saveBgFromAttachment, deleteBg, getBgPath };
