// vc_recruit.js — VC(通話)がずっと無人のとき、誘導ボタン付きメッセージを自動投稿する
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { getSettings } = require('./config');
const { getLastMessageTime } = require('./chatter');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const DEFAULT_RECRUIT_ROLE_ID = '1477518549198049362';

const VC_EMPTY_MS       = 2  * 60 * 60 * 1000; // VCに2時間誰もいない状態が続いたら対象
const TEXT_ACTIVE_MS    = 3  * 60 * 60 * 1000; // 直近3時間にテキストの発言がない＝サーバー自体が無人と判断してスキップ
const POST_COOLDOWN_MS  = 6  * 60 * 60 * 1000; // 自動投稿の間隔
const CHECK_INTERVAL_MS = 10 * 60 * 1000;      // 10分ごとチェック
const PRESS_COOLDOWN_MS = 6  * 60 * 60 * 1000; // 1人が連打でロールメンションを乱発できないよう制限

const PRESS_FILE = resolveDataPath('vc_recruit_presses.json');
ensureDir(PRESS_FILE);
let pressLog = readJson(PRESS_FILE, {}); // userId -> 最終押下時刻

let lastVCActiveTime = Date.now(); // 起動時は「今」扱い（起動直後の誤爆防止）
let lastPostedTime   = 0;

function getVCRecruitSettings() {
    const settings = getSettings();
    return {
        channelId: settings.vcRecruitChannelId ?? settings.chatterChannelId ?? null,
        roleId:    settings.vcRecruitRoleId ?? DEFAULT_RECRUIT_ROLE_ID,
    };
}

// voiceStateUpdateのたびに呼ばれ、VCに誰か（Bot以外）が残っているか監視する
function recordVoiceStateForRecruit(guild) {
    const anyoneInVC = guild.channels.cache.some(c =>
        (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) &&
        c.members.filter(m => !m.user.bot).size > 0
    );
    if (anyoneInVC) lastVCActiveTime = Date.now();
}

function buildRecruitMessage(guild) {
    const embed = new EmbedBuilder()
        .setTitle('🔊 VCだれかいる？')
        .setDescription('最近だれもVCしてないみたい…暇な人いたら来て〜')
        .setColor(0x5865F2)
        .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vcrecruit_press').setLabel('VCに誘う').setEmoji('📣').setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [row] };
}

async function postRecruitMessage(channel, guild) {
    await channel.send(buildRecruitMessage(guild));
    lastPostedTime = Date.now();
}

async function tryPostRecruit(client) {
    const { channelId } = getVCRecruitSettings();
    if (!channelId) return;

    const now = Date.now();
    if (now - lastVCActiveTime < VC_EMPTY_MS) return;
    if (now - lastPostedTime   < POST_COOLDOWN_MS) return;
    if (now - getLastMessageTime() > TEXT_ACTIVE_MS) return; // サーバー自体が無人ならスキップ

    const guild = client.guilds.cache.first();
    if (!guild) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    await postRecruitMessage(channel, guild);
    console.log('[VCRecruit] ✅ VC募集メッセージを自動投稿しました');
}

// 押下回数の厳格な制限（1人あたりクールダウン、再起動をまたいで永続化）
function checkAndRecordPress(userId) {
    const now  = Date.now();
    const last = pressLog[userId];
    if (last && now - last < PRESS_COOLDOWN_MS) {
        return { ok: false, retryAt: last + PRESS_COOLDOWN_MS };
    }
    pressLog[userId] = now;
    writeJson(PRESS_FILE, pressLog);
    return { ok: true };
}

async function handleVCRecruitButton(interaction) {
    const { ok, retryAt } = checkAndRecordPress(interaction.user.id);
    if (!ok) {
        return interaction.reply({
            content: `⏳ 連打防止のため制限中です。次は <t:${Math.floor(retryAt / 1000)}:R> から押せます。`,
            ephemeral: true,
        });
    }

    const { roleId } = getVCRecruitSettings();
    return interaction.reply({
        content: `📣 <@${interaction.user.id}> がVCに誘っています！${roleId ? `<@&${roleId}>` : ''}`,
        allowedMentions: { users: [interaction.user.id], roles: roleId ? [roleId] : [] },
    });
}

// /admin vc_recruit からの試し打ち用。無人判定・クールダウンを無視し、コマンド実行チャンネルに即投稿する
async function forceRecruitPost(interaction) {
    await postRecruitMessage(interaction.channel, interaction.guild);
}

function initVCRecruit(client) {
    setInterval(() => {
        tryPostRecruit(client).catch(e => console.error('[VCRecruit] エラー:', e.message));
    }, CHECK_INTERVAL_MS);
    console.log('[VCRecruit] ✅ 初期化 | VC無人が続くと自動で誘導メッセージを投稿');
}

module.exports = {
    initVCRecruit,
    recordVoiceStateForRecruit,
    handleVCRecruitButton,
    forceRecruitPost,
    getVCRecruitSettings,
    DEFAULT_RECRUIT_ROLE_ID,
};
