// scanner.js — スタンドアロンNGスキャナー
// 使い方: node scanner.js <ファイルパス>
// 結果は .env の SCAN_REPORT_WEBHOOK_URL に送信

require('dotenv').config();
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const filePath = process.argv[2];
if (!filePath) {
    console.error('使い方: node scanner.js <ファイルパス>');
    process.exit(1);
}
if (!fs.existsSync(filePath)) {
    console.error('ファイルが見つかりません:', filePath);
    process.exit(1);
}

// ─── NG判定ロジック ───

function normalizeForDetection(text) {
    if (!text) return '';
    return text
        .replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[​-‏⁠⁡﻿­]/g, '')
        .toLowerCase()
        .replace(/[\s　_\-.,。、・「」『』【】〔〕《》〈〉（）()\[\]{}*★☆◆◇●○]/g, '');
}

const LOLI_SHOTA_REGEX = new RegExp([
    'ロリ','ろり','ﾛﾘ','loli',
    'ショタ','しょた','ｼｮﾀ','shota',
    'ロリコン','ろりこん','lolicon',
    'ショタコン','しょたこん','shotacon',
    '幼女','幼男','キッズ',
    '小学生','中学生','小学校','中学校',
    'ペド','ぺど',
    'p\\W*e\\W*d\\W*o',
    '小児性愛','幼児性愛','小児愛',
    'ペドフィリア','ペドフィール',
    '援交','えんこう','援助交際',
    '児童ポルノ','児童買春','児童わいせつ',
    '幼児わいせつ','幼児淫行',
    'csam',
    'child\\W*porn','child\\W*abuse\\W*mater',
    'エプスタイン','🧒','👧','👦','🍼','🎒',
    '児童','未成年',
    'ガキ','がき',
    '女児','男児','幼児',
    '乳児','乳幼児','園児','新生児',
    '女子小学生','女子中学生','じょしこうせい',
    'おさな(?:妻|い子)',
    '年端もいかない',
    'cp',
    'minor',
    'map(?:community|pride|flag)',
    'hebephil','ephebophil',
    '少女',
    '少年愛',
    '児ポ',
    '制服',
    '体操着',
    '水着',
    'ランドセル',
    '放課後',
    'jailbait',
    'preteen',
    'underage',
    'child\\s*(?:sex|sexual|molest|abuse|exploit)',
    'JK','JC','JS',
].join('|'), 'i');

const AGE_REGEX = new RegExp([
    '(?:[0-9]|1[0-2])(?:歳|才|さい)',
    '(?:[０-９]|１[０-２])(?:歳|才|さい)',
    '(?:一|二|三|四|五|六|七|八|九|十|十一|十二)(?:歳|才|さい)',
    '13歳未満','小[1-6]','中[1-3]',
    '(?:[1-9]|1[0-2])\\s*(?:yo|y\\/o|year\\W*old)',
    'u\\s*18',
].join('|'), 'i');

const THREAT_REGEX = new RegExp([
    '殺','死ね','しね','死ねよ','死んでしまえ',
    '殺す','ころす','殺してやる','殺すぞ','ぶっ殺',
    '爆破','爆殺','刺す','刺してやる','刺すぞ',
    '銃',
    'kill\\s*you',"i'?ll\\s*kill",'gonna\\s*kill','want\\s*(?:you\\s*)?dead',
    '自殺しろ','死んでください','死んでほしい','死んでくれ',
    'テロ',
    '大量虐殺',
    'mass\\s*shoot(?:ing)?',
    'school\\s*shoot(?:ing)?',
    '無差別殺人','無差別テロ','無差別攻撃',
].join('|'), 'i');

const DRUG_REGEX = new RegExp([
    '覚醒剤','覚せい剤','MDM[Aa]','コカイン','ヘロイン',
    '大麻','マリファナ','危険ドラッグ','脱法ドラッグ',
    'シャブ','やく',
    'drug',
].join('|'), 'i');

const SELF_HARM_PROMO_REGEX = new RegExp([
    '首吊り',
    '首を吊る',
    '飛び降り',
    '自殺',
    '死に方',
    '楽に死ぬ',
    '安楽死',
    'od',
    '睡眠薬',
    '過剰摂取',
    'リストカット',
    'リスカ',
    '練炭自殺',
    '入水自殺',
    '焼身自殺',
    '電車に飛び込む',
    '死にたい','死のう','死んでしまいたい','死にたくなった',
    '生きていたくない',
    '生きてる意味',
    '消えてしまいたい',
    'suicide',
    'kill\\s*myself',
    'commit\\s*suicide',
].join('|'), 'i');

const HATE_REGEX = new RegExp([
    'チャンコロ','チョンコ','チョン','支那','在日',
    '民族浄化','人種浄化',
    '生きるに値しない命','生きる価値ない',
    'nigger','nigga','n\\s*[-_]\\s*word',
    'ニガー','ニガ',
    '黒人(?:死ね|消えろ|猿|ゴミ|クズ)',
    'kike','ユダヤ',
    'ホロコースト(?:は嘘|なかった|否定)',
    'holocaust\\s*(?:denial|lie|fake|hoax)',
    'antisemit',
    'white\\s*power','white\\s*supremac','white\\s*nationalist',
    'heil\\s*hitler','ハイル\\s*ヒトラー',
    'ナチス','14\\s*words','88\\s*(?:heil|万歳)',
    'white\\s*lives\\s*matter',
    'chink','チンク','gook',
    '朝鮮人(?:ゴキブリ|害虫|猿|死ね|消えろ)',
    '韓国人(?:ゴキブリ|害虫|猿|死ね|消えろ)',
    'シナ人','jap',
    'towelhead','raghead','sand\\s*n(?:igger|igga)','camel\\s*jockey',
    'ethnic\\s*cleansing','race\\s*war','genocide',
    '外国人排斥','移民排斥','外国人駆逐','売国',
    'spic','beaner','wetback','slope','zipperhead',
    'curry\\s*(?:muncher|nigger)','paki',
    'ゲイ','げい','レズ','れず','レズビアン',
    'ホモ','ほも','オカマ','おかま','お釜','オネエ',
    'ニューハーフ','ﾆｭｰﾊｰﾌ','オナベ','おなべ',
    'バイセクシャル','バイセクシュアル',
    'クィア','クエスチョニング',
    'トランスジェンダー','トランスセクシャル',
    'LGBT','LGBTQ','同性愛','ふたなり',
].join('|'), 'i');

const DISABILITY_HATE_REGEX = new RegExp([
    'かたわ','びっこ','めくら','つんぼ','いざり',
    '知恵遅れ','ガイジ','ハッタショ','アスペ','スペ',
    'キチガイ','きちがい','基地外','メンヘラ','精神異常',
    'キ○ガイ','キ◯ガイ','retard','spastic','mental(?:ly)?\\s*retard',
].join('|'), 'i');

function checkNgWords(text) {
    const matched = [];
    function test(regex, label) {
        const m = text.match(regex);
        if (m) matched.push(`${label}(${m[0].slice(0, 20)})`);
    }
    test(LOLI_SHOTA_REGEX,      'loli_shota');
    test(AGE_REGEX,             'age');
    test(THREAT_REGEX,          'threat');
    test(DRUG_REGEX,            'drug');
    test(SELF_HARM_PROMO_REGEX, 'self_harm_promo');
    test(HATE_REGEX,            'hate_speech');
    test(DISABILITY_HATE_REGEX, 'disability_hate');
    return { hit: matched.length > 0, matched };
}

// ─── パーサー ───

function repairJson(text) {
    try { return JSON.parse(text); } catch {}
    const t = text.trimEnd();
    for (const suffix of [
        '\n  ]\n}',
        '\n    }\n  ]\n}',
        '"\n    }\n  ]\n}',
        '"\n      ]\n    }\n  ]\n}',
        '\n      ]\n    }\n  ]\n}',
        ']\n    }\n  ]\n}',
        '}\n    ]\n    }\n  ]\n}',
    ]) {
        try { return JSON.parse(t + suffix); } catch {}
    }
    throw new SyntaxError('JSONの修復に失敗しました');
}

function parseFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const ext = filePath.split('.').pop().toLowerCase();

    if (ext === 'json') {
        const data = repairJson(raw);
        const guildId   = data.guild?.id   ?? '0';
        const channelId = data.channel?.id ?? '0';
        const messages  = (data.messages ?? []).filter(msg => !msg.author?.isBot).map(msg => ({
            authorName: msg.author?.nickname || msg.author?.name || '不明',
            date:       msg.timestamp ?? '',
            content:    msg.content   ?? '',
            messageId:  msg.id        ?? '',
            guildId,
            channelId,
        }));
        return messages;
    }

    // CSV
    const lines = raw.split('\n');
    const start = /^AuthorID/i.test(lines[0]) ? 1 : 0;
    const m = filePath.match(/\[(\d{17,20})\]/);
    const channelId = m ? m[1] : '0';
    return lines.slice(start).filter(l => l.trim()).map(line => {
        const cols = splitCsv(line);
        return {
            authorName: (cols[1] || '').trim(),
            date:       (cols[2] || '').trim(),
            content:    (cols[3] || '').trim(),
            messageId:  '',
            guildId:    '0',
            channelId,
        };
    }).filter(m => m.content);
}

function splitCsv(line) {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i+1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
            cols.push(cur); cur = '';
        } else cur += ch;
    }
    cols.push(cur);
    return cols;
}

// ─── Webhook送信 ───

async function sendWebhook(embed) {
    const url = process.env.SCAN_REPORT_WEBHOOK_URL;
    if (!url) {
        console.log('[WEBHOOK未設定] カテゴリ:', embed.description?.split('\n')[0]);
        return;
    }
    const body = JSON.stringify({ embeds: [embed] });
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
        const req = mod.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, res => {
            res.resume();
            res.on('end', resolve);
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ─── メイン ───

async function main() {
    console.log('📂 読み込み:', filePath);
    let messages;
    try {
        messages = parseFile(filePath);
    } catch (e) {
        console.error('❌ ファイル読み込みエラー:', e.message);
        process.exit(1);
    }
    console.log(`✅ ${messages.length}件読み込み完了`);

    const hits = [];
    for (const msg of messages) {
        if (!msg.content) continue;
        const { hit, matched } = checkNgWords(normalizeForDetection(msg.content));
        if (hit) hits.push({ ...msg, matched });
    }
    console.log(`🔍 NGヒット: ${hits.length}件`);

    if (!hits.length) {
        console.log('✅ NGワードなし');
        return;
    }

    let sent = 0;
    for (const hit of hits) {
        const link = hit.messageId
            ? `https://discord.com/channels/${hit.guildId}/${hit.channelId}/${hit.messageId}`
            : `https://discord.com/channels/0/${hit.channelId}/0`;

        const embed = {
            color: 0xff4040,
            title: '🚨 NGワード検出',
            description: `**カテゴリ:** ${hit.matched.join(', ')}\n**リンク:** ${link}`,
            fields: [
                { name: '発言者', value: hit.authorName || '不明', inline: true },
                { name: '日時',   value: hit.date || '不明',       inline: true },
                { name: '内容',   value: (hit.content || '').slice(0, 300), inline: false },
            ],
            footer: { text: filePath },
        };

        try {
            await sendWebhook(embed);
            sent++;
            process.stdout.write(`\r送信中... ${sent}/${hits.length}`);
        } catch (e) {
            console.error('\n[送信失敗]', e.message);
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.log(`\n✅ 完了: ${sent}件送信`);
}

main().catch(e => { console.error(e); process.exit(1); });
