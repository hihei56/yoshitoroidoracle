// rankCard.js — sharp + SVG でランクカード画像を生成
const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');
const { resolveDataPath, ensureDir } = require('./dataPath');
const { XP_PER_LEVEL, getLevelBadge } = require('./xp');

const BG_DIR = resolveDataPath('backgrounds');
ensureDir(path.join(BG_DIR, '.keep'));

const W = 900, H = 250;
const FONT = 'Noto Sans CJK JP, Noto Sans, sans-serif';

function toHex(colorInt) {
    return '#' + colorInt.toString(16).padStart(6, '0');
}

async function fetchBuf(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function circleAvatar(buf, size = 180) {
    const mask = Buffer.from(
        `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></svg>`
    );
    return sharp(buf)
        .resize(size, size)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function uiSvg({ level, xp, levelBase, accent, name, rank, badge }) {
    const current  = Math.max(0, xp - (levelBase ?? xp));
    const progress = Math.min(current / XP_PER_LEVEL, 1);

    // レイアウト定数
    const avatarSize = 180;
    const avatarX    = 35;
    const avatarY    = (H - avatarSize) / 2;  // 35
    const textX      = avatarX + avatarSize + 30; // 245
    const barX       = textX;
    const barY       = H - 52;
    const barW       = W - barX - 30;
    const barH       = 20;
    const filled     = Math.round(barW * progress);

    const rankStr    = rank ? `#${rank}` : '—';
    const totalStr   = Math.floor(xp).toLocaleString('en-US');
    const curStr     = Math.floor(current).toLocaleString('en-US');
    const nextStr    = XP_PER_LEVEL.toLocaleString('en-US');
    const safeName   = esc(name);

    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bar" x1="0" y1="0" x2="${barW}" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="${accent}"/>
                <stop offset="100%" stop-color="${accent}88"/>
            </linearGradient>
            <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#00000066"/>
            </filter>
        </defs>

        <!-- 左アクセントライン -->
        <rect x="0" y="0" width="6" height="${H}" fill="${accent}" rx="3"/>

        <!-- ユーザー名 -->
        <text x="${textX}" y="68" font-family="${FONT}" font-size="32" font-weight="700"
              fill="#ffffff" filter="url(#shadow)">${safeName}</text>

        <!-- バッジ emoji + Lv -->
        <text x="${textX}" y="112" font-family="${FONT}" font-size="22" fill="${accent}" font-weight="600">${badge.emoji} Lv.${level}</text>

        <!-- Rank と Total -->
        <text x="${textX + 160}" y="112" font-family="${FONT}" font-size="18" fill="#ffffffaa">Rank</text>
        <text x="${textX + 210}" y="112" font-family="${FONT}" font-size="22" fill="#ffffff" font-weight="700">${rankStr}</text>

        <text x="${textX + 310}" y="112" font-family="${FONT}" font-size="18" fill="#ffffffaa">Total XP</text>
        <text x="${textX + 400}" y="112" font-family="${FONT}" font-size="22" fill="#ffffff" font-weight="700">${totalStr}</text>

        <!-- プログレスバー 背景 -->
        <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#ffffff18"/>
        <!-- プログレスバー 塗り -->
        ${filled > 0 ? `<rect x="${barX}" y="${barY}" width="${filled}" height="${barH}" rx="${barH / 2}" fill="url(#bar)"/>` : ''}
        <!-- バー内グロー -->
        ${filled > 6 ? `<rect x="${barX + 3}" y="${barY + 4}" width="${Math.max(0, filled - 6)}" height="${barH / 2 - 4}" rx="${barH / 4}" fill="${accent}44"/>` : ''}

        <!-- XP テキスト -->
        <text x="${barX}" y="${barY - 8}" font-family="${FONT}" font-size="14" fill="#ffffffbb">${curStr} / ${nextStr} XP</text>
    </svg>`;
}

async function generateRankCard(userData, user, rank) {
    const { level, xp, levelBase, bgUrl } = userData;
    const badge  = getLevelBadge(level);
    const accent = toHex(badge.color);

    // アバター取得（先にやっておく）
    let avatarCircle = null;
    try {
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
        const avatarBuf = await fetchBuf(avatarUrl);
        avatarCircle    = await circleAvatar(avatarBuf, 180);
    } catch { /* 失敗は無視 */ }

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
            const isLocal = bgUrl.startsWith('/');
            const rawBuf  = isLocal ? fs.readFileSync(bgUrl) : await fetchBuf(bgUrl);
            const roundMask = Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="16"/></svg>`);
            const resized   = await sharp(rawBuf).resize(W, H, { fit: 'cover' }).png().toBuffer();
            const rounded   = await sharp(resized).composite([{ input: roundMask, blend: 'dest-in' }]).png().toBuffer();
            const overlay   = Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000000aa" rx="16"/></svg>`);
            base = await sharp(rounded).composite([{ input: overlay }]).png().toBuffer();
        } catch {
            base = await sharp(gradSvg).png().toBuffer();
        }
    } else {
        base = await sharp(gradSvg).png().toBuffer();
    }

    // ── UI SVG（テキスト込み）────────────────────────────────────────
    const uiLayer = Buffer.from(uiSvg({ level, xp, levelBase, accent, name: userData.displayName ?? user.username, rank, badge }));

    const layers = [{ input: uiLayer, left: 0, top: 0 }];
    if (avatarCircle) {
        layers.push({ input: avatarCircle, left: 35, top: Math.round((H - 180) / 2) });
    }

    return sharp(base).composite(layers).png().toBuffer();
}

/** ユーザーのカスタム背景をローカルに保存し、パスを返す */
async function saveBgFromUrl(userId, url) {
    const buf     = await fetchBuf(url);
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
