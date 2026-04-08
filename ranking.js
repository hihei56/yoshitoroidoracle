// ranking.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, WebhookClient } = require('discord.js');
const axios = require('axios');

const YOUTUBE_API_KEY      = process.env.YOUTUBE_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const RANKING_CHANNEL_ID   = process.env.RANKING_CHANNEL_ID;
const WEBHOOK_URL          = process.env.RANKING_WEBHOOK_URL;

// ★あなたが指定したフォーラム内の実況スレッドID
const RANKING_FORUM_THREAD_ID = '1488170886702829609'; 

const TOP_N = 5;

// ══════════════════════════════════════════════════════════
//  Twitch（日本語配信取得）
// ══════════════════════════════════════════════════════════
let twitchTokenCache = { token: null, expiresAt: 0 };

async function getTwitchToken() {
    if (twitchTokenCache.token && twitchTokenCache.expiresAt > Date.now() + 60_000)
        return twitchTokenCache.token;
    const data = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
        { method: 'POST' }
    ).then(r => r.json());
    twitchTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return twitchTokenCache.token;
}

async function fetchTwitchTop(n) {
    const token = await getTwitchToken();
    const headers = { 'Client-Id': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` };

    const { data: streams = [] } = await fetch(
        `https://api.twitch.tv/helix/streams?first=50&language=ja`, { headers }
    ).then(r => r.json());
    if (!streams.length) return [];

    const ids = streams.map(s => `id=${s.user_id}`).join('&');
    const { data: users = [] } = await fetch(
        `https://api.twitch.tv/helix/users?${ids}`, { headers }
    ).then(r => r.json());
    const userMap = Object.fromEntries(
        users.map(u => [u.id, { name: u.display_name, avatar: u.profile_image_url }])
    );

    return streams.map(s => ({
        platform: 'Twitch',
        name:     userMap[s.user_id]?.name ?? s.user_login,
        avatar:   userMap[s.user_id]?.avatar ?? null,
        title:    s.title,
        viewers:  s.viewer_count,
        url:      `https://twitch.tv/${s.user_login}`,
        game:     s.game_name ?? '',
    }));
}

// ══════════════════════════════════════════════════════════
//  YouTube（日本語配信取得）
// ══════════════════════════════════════════════════════════
async function fetchYouTubeTop(n) {
    try {
        const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
        Object.entries({
            part: 'id', eventType: 'live', type: 'video',
            order: 'viewCount', maxResults: 50,
            relevanceLanguage: 'ja', q: ' ',
            key: YOUTUBE_API_KEY,
        }).forEach(([k, v]) => searchUrl.searchParams.set(k, v));

        const searchRes = await fetch(searchUrl).then(r => r.json());
        if (!searchRes.items?.length) return [];

        const videoUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        Object.entries({
            part: 'snippet,liveStreamingDetails',
            id: searchRes.items.map(i => i.id.videoId).join(','),
            key: YOUTUBE_API_KEY,
        }).forEach(([k, v]) => videoUrl.searchParams.set(k, v));

        const videoRes = await fetch(videoUrl).then(r => r.json());
        const videos = videoRes.items ?? [];

        const jaFiltered = videos.filter(v => {
            const lang = v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? '';
            return (v.liveStreamingDetails?.concurrentViewers != null) && (lang === '' || lang.startsWith('ja'));
        });

        const chUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
        Object.entries({
            part: 'snippet',
            id: jaFiltered.map(v => v.snippet.channelId).join(','),
            key: YOUTUBE_API_KEY,
        }).forEach(([k, v]) => chUrl.searchParams.set(k, v));

        const chRes = await fetch(chUrl).then(r => r.json());
        const chMap = Object.fromEntries((chRes.items ?? []).map(c => [c.id, {
            name: c.snippet.title,
            avatar: c.snippet.thumbnails?.default?.url ?? null,
        }]));

        return jaFiltered.map(v => ({
            platform: 'YouTube',
            name:     chMap[v.snippet.channelId]?.name ?? '不明',
            avatar:   chMap[v.snippet.channelId]?.avatar ?? null,
            title:    v.snippet.title,
            viewers:  parseInt(v.liveStreamingDetails.concurrentViewers, 10),
            url:      `https://www.youtube.com/watch?v=${v.id}`,
            game:     '',
        }));
    } catch (e) {
        console.error('[YT Error]', e.message);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  Embed生成
// ══════════════════════════════════════════════════════════
function buildPayload(list) {
    const top = list[0];
    if (!top) return { embeds: [], components: [] };

    const lines = list.map((e, i) => {
        const viewers = e.viewers.toLocaleString('ja-JP');
        const platIcon = e.platform === 'YouTube' ? '▶️' : '📡';
        return `**${i + 1}位 [${e.name}](${e.url})** ${platIcon} 👥 ${viewers}人`;
    }).join('\n\n');

    const embed = {
        title: '🏆 現在の同時接続数ランキング',
        description: lines,
        color: 0xff0000,
        thumbnail: top.avatar ? { url: top.avatar } : undefined,
        footer: { text: `📡 配信情報局 · ${new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}` },
    };

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(`🥇 1位: ${top.name} を見る`)
            .setURL(top.url)
            .setStyle(ButtonStyle.Link)
    );

    return { embeds: [embed], components: [row] };
}

// ══════════════════════════════════════════════════════════
//  投稿メイン
// ══════════════════════════════════════════════════════════
async function postRanking(client) {
    if (!WEBHOOK_URL) return console.error('[Ranking] WEBHOOK_URL 未設定');

    const [twitchList, youtubeList] = await Promise.all([
        fetchTwitchTop(TOP_N).catch(() => []),
        fetchYouTubeTop(TOP_N).catch(() => []),
    ]);

    const allStreams = [...twitchList, ...youtubeList];

    // --- 1. 姫森ルーナ特別枠 (1万人以上なら即通知) ---
    const lunaStream = allStreams.find(e => e.name.includes('姫森ルーナ') && e.viewers >= 10000);
    const webhookClient = new WebhookClient({ url: WEBHOOK_URL });

    if (lunaStream) {
        await webhookClient.send({
            content: `🍬 **んなあああああ！！ルーナたん1万人超えだにぇ！ (${(lunaStream.viewers).toLocaleString()}人)**\n${lunaStream.url}`,
            username: '🍬 んなたん監視員',
            threadId: RANKING_FORUM_THREAD_ID,
            avatarURL: lunaStream.avatar || undefined,
        });
    }

    // --- 2. 通常ランキング (1万人以上の覇権のみ) ---
    const filtered = allStreams
        .filter(e => e.viewers >= 10000)
        .sort((a, b) => b.viewers - a.viewers)
        .slice(0, TOP_N);

    if (!filtered.length) {
        console.log('[Ranking] 条件を満たす覇権配信なし');
        return;
    }

    const top1 = filtered[0];
    const CUSTOM_REACTIONS = {
        '加藤純一': '加藤純一最強🔥 加藤純一最強🔥',
        'さくらみこ': 'みこちの勝ちだにぇw🌸',
        '兎田ぺこら': 'やっぱぺこーらよ！🐰',
        '宝鐘マリン': 'Ahoy！！出港～🏴‍☠️'
    };

    let aiComment = "";
    const matchedKey = Object.keys(CUSTOM_REACTIONS).find(k => top1.name.includes(k));

    if (matchedKey) {
        aiComment = CUSTOM_REACTIONS[matchedKey];
    } else {
        try {
            const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "あなたは5chの実況スレ住民です。同接5万人超えの配信について、勢いのある1行レス（25文字以内）を生成せよ。語尾はｗ、草、始まったな、等。" },
                    { role: "user", content: `配信者: ${top1.name}\nタイトル: ${top1.title}` }
                ]
            }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 10000 });
            aiComment = res.data.choices[0].message.content.replace(/["'「」]/g, "");
        } catch {
            aiComment = "覇権確定で草ｗｗｗ";
        }
    }

    const payload = buildPayload(filtered);
    await webhookClient.send({
        content: `🔥 **${aiComment}**\n現在 **${(top1.viewers / 10000).toFixed(1)}万人** 視聴中！`,
        username: '📡 配信同接観測ボット',
        threadId: RANKING_FORUM_THREAD_ID,
        embeds: payload.embeds,
        components: payload.components,
        avatarURL: top1.avatar || undefined,
    });
}

async function handleRanking(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await postRanking(interaction.client);
    await interaction.editReply({ content: '✅ 指定スレッドに投稿しました！' });
}

module.exports = { postRanking, handleRanking };