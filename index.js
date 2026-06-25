// index.js — Oracle Cloud対応版
process.on('uncaughtException',  e => console.error('[Error]:', e));
process.on('unhandledRejection', e => console.error('[Reject]:', e));

require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { handleAnon }             = require('./anon');
const { handleCurse }            = require('./curse');
const { initLurker, handleLurker } = require('./lurker');
const { recordActivity, backfillActivity } = require('./activity_tracker');
const { handleDeathmatch }       = require('./deathmatch');
const { handleModerator, handlePoopReaction, handleCryReaction, handleEmbedModerator, handleCandyReaction, handleEditDM } = require('./moderator');
const { handleImpersonate }      = require('./impersonate');
const { handleImp }              = require('./imp');
const { handleAdmin, handleAdminButton, handleServersLeaveSelect, handleServersLeaveConfirm, handleServersLeaveCancel, handlePresence, restorePresence } = require('./admin');
const { handleJoker }            = require('./joker');
const { initRSS }                = require('./rssBot');
const { postRanking, handleRanking } = require('./ranking');
const { handleTimeoutList }      = require('./timeoutlist');
const { initSecurity, handlePermList } = require('./security');
const { handleInviteFilter, handleNGServer } = require('./invite_filter');
const { handleEditMonitor } = require('./edit_monitor');
const { processMessage, getUserData, getLeaderboard, xpToNextLevel, XP_PER_LEVEL, buildNickname } = require('./xp');

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
if (DEBUG_MODE) console.log('🐛 [Debug] デバッグモード有効');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const ALLOWED_ROLES = ['1476944370694488134', '1478715790575538359'];

const ADMIN_ROLE_ID = '1495971497016164492';

function buildProgressBar(current, max, size = 15) {
    const filled = Math.round((current / max) * size);
    return '█'.repeat(filled) + '░'.repeat(size - filled) + ` (${Math.floor(current)}/${max})`;
}

function hasPermission(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.roles.cache.has(ADMIN_ROLE_ID)) return true;
    return ALLOWED_ROLES.some(id => member.roles.cache.has(id));
}

client.once(Events.ClientReady, async c => {
    console.log(`✅ [Bot Ready] ${c.user.tag}`);
    console.log(`📁 DATA_DIR=${process.env.DATA_DIR ?? '(未設定・スクリプト同階層)'}`);

    initSecurity(client);
    initRSS(client);
    initLurker(client);
    restorePresence(client).catch(e => console.error('[PRESENCE] 復元エラー:', e));

    const guild = client.guilds.cache.first();
    if (guild) backfillActivity(guild).catch(e => console.error('[Activity] バックフィルエラー:', e));

    if (DEBUG_MODE) {
        postRanking(client).catch(e => console.error('[Ranking] 起動時エラー:', e));
        setInterval(() => {
            postRanking(client).catch(e => console.error('[Ranking] 定期更新エラー:', e));
        }, 60 * 60 * 1000);
    }
});

client.on(Events.MessageCreate, async m => {
    if (m.author.bot) return;
    if (!m.guild) {
        handleEditDM(m).catch(e => console.error('[EditDM Error]:', e));
        return;
    }
    recordActivity(m.author.id);
    handleInviteFilter(m, client).catch(err => console.error('[InviteFilter Error]:', err));
    handleModerator(m).catch(err => console.error('[Mod Error]:', err));

    // XP処理
    const xpResult = processMessage(m.author.id, m.content);
    if (xpResult.newLevel !== null) {
        m.channel.send(`🎉 <@${m.author.id}> がレベル **${xpResult.newLevel}** に上がりました！ (合計 ${Math.floor(xpResult.after)} XP)`).catch(() => {});
        // ニックネーム末尾にレベルバッジを付与
        const member = m.member ?? await m.guild.members.fetch(m.author.id).catch(() => null);
        if (member && member.manageable) {
            const base = member.nickname ?? member.user.username;
            member.setNickname(buildNickname(base, xpResult.newLevel)).catch(() => {});
        }
    }
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    handleEmbedModerator(oldMessage, newMessage).catch(e => console.error('[EmbedMod Error]:', e));
    handleEditMonitor(oldMessage, newMessage).catch(e => console.error('[EditMon Error]:', e));
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    handlePoopReaction(reaction, user).catch(e => console.error('[PoopReaction]:', e));
    handleCryReaction(reaction, user).catch(e => console.error('[CryReaction]:', e));
    handleCandyReaction(reaction, user).catch(e => console.error('[CandyReaction]:', e));
});

client.on(Events.InteractionCreate, async i => {
    // 管理設定リセットボタン
    if (i.isButton() && i.customId.startsWith('admin_reset:')) {
        return handleAdminButton(i).catch(e => console.error('[AdminBtn]:', e));
    }

    // サーバー退出セレクトメニュー
    if (i.isStringSelectMenu() && i.customId === 'admin_servers:leave_select') {
        return handleServersLeaveSelect(i).catch(e => console.error('[ServersSelect]:', e));
    }

    // サーバー退出確認ボタン
    if (i.isButton() && i.customId.startsWith('admin_servers:leave_confirm:')) {
        const guildId = i.customId.split(':')[2];
        return handleServersLeaveConfirm(i, guildId).catch(e => console.error('[ServersConfirm]:', e));
    }

    // サーバー退出キャンセルボタン
    if (i.isButton() && i.customId === 'admin_servers:leave_cancel') {
        return handleServersLeaveCancel(i).catch(e => console.error('[ServersCancel]:', e));
    }

    if (!i.isChatInputCommand()) return;

    // /imp は独自権限チェックのためhasPermissionをスキップ
    if (i.commandName === 'imp') {
        return handleImp(i).catch(e => console.error('[Imp Error]:', e));
    }

    // /rank は全員使用可能
    if (i.commandName === 'rank') {
        try {
            const sub = i.options.getSubcommand(false);
            if (sub === 'top') {
                const board = getLeaderboard(10);
                if (!board.length) return i.reply({ content: 'まだ誰もXPを獲得していません。', ephemeral: true });
                const lines = await Promise.all(board.map(async (e, idx) => {
                    const member = await i.guild.members.fetch(e.id).catch(() => null);
                    const name   = member?.displayName ?? `<@${e.id}>`;
                    return `**${idx + 1}位** ${name} — Lv.**${e.level}** / ${Math.floor(e.xp)} XP`;
                }));
                return i.reply({ embeds: [{ title: '🏆 XPランキング TOP10', description: lines.join('\n'), color: 0xf5a623 }] });
            }
            // show (デフォルト)
            const target  = i.options.getUser('user') ?? i.user;
            const data    = getUserData(target.id);
            const needed  = xpToNextLevel(data);
            const current = data.xp - data.level * XP_PER_LEVEL;
            const bar     = buildProgressBar(current, XP_PER_LEVEL);
            return i.reply({ embeds: [{
                title: `⭐ ${target.displayName ?? target.username} の経験値`,
                description: [
                    `レベル: **${data.level}**`,
                    `累計XP: **${Math.floor(data.xp)}**`,
                    `次のレベルまで: **${needed.toFixed(1)} XP**`,
                    `${bar}`,
                ].join('\n'),
                color: 0x5865f2,
            }] });
        } catch (e) {
            console.error('[Rank Error]:', e);
        }
        return;
    }

    if (!hasPermission(i.member)) {
        return i.reply({ content: 'このボットを使用する権限がありません。', ephemeral: true });
    }

    try {
        if (i.commandName === 'timeoutlist') await handleTimeoutList(i);
        if (i.commandName === 'dice')        await handleDeathmatch(i);
        if (i.commandName === 'anon')        await handleAnon(i);
        if (i.commandName === 'curse')       await handleCurse(i);
        if (i.commandName === 'lurker')      await handleLurker(i);
        if (i.commandName === 'admin') {
            const sub = i.options.getSubcommand();
            if (sub === 'ngserver')  await handleNGServer(i);
            else if (sub === 'presence') await handlePresence(i);
            else                         await handleAdmin(i);
        }
        if (i.commandName === 'joker')       await handleJoker(i);
        if (i.commandName === 'permlist')    await handlePermList(i);
        if (i.commandName === 'impersonate') await handleImpersonate(i);
        if (i.commandName === 'ranking') {
            if (!DEBUG_MODE) return i.reply({ content: '⚠️ DEBUG_MODE=true が必要です。', ephemeral: true });
            await handleRanking(i);
        }
    } catch (e) {
        console.error('[Interaction Error]:', e);
    }
});

// 死活監視用HTTPサーバー
require('http')
    .createServer((req, res) => res.end('OK'))
    .listen(3000, () => console.log('🌐 HTTP Server Ready (Port: 3000)'));

async function shutdown(signal) {
    console.log(`[Shutdown] ${signal} 受信 - 終了処理中...`);
    try { await client.destroy(); } catch {}
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

client.login(process.env.DISCORD_TOKEN);