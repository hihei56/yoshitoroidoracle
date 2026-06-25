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
const { generateRankCard, saveBgFromUrl, saveBgFromAttachment, deleteBg, getBgPath } = require('./rankCard');
const {
    XP_PER_LEVEL,
    processMessage, getUserData, getRank, getLeaderboard, xpToNextLevel,
    getPeriodXp, getLeaderboardByPeriod,
    setUserLevel, adjustXP, resetUser,
    setHideBadge, isHideBadge,
    addExcludedRole, removeExcludedRole, getExcludedRoles, isExcluded,
    buildNickname, getLevelBadge,
} = require('./xp');

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

function hasPermission(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.roles.cache.has(ADMIN_ROLE_ID)) return true;
    return ALLOWED_ROLES.some(id => member.roles.cache.has(id));
}

// ── ランクカード（画像）を送信 ────────────────────────────────────────
async function sendRankCard(replyTarget, targetUser, guild) {
    const data   = getUserData(targetUser.id);
    const rank   = getRank(targetUser.id);
    const badge  = getLevelBadge(data.level);
    const member = await guild?.members.fetch(targetUser.id).catch(() => null);
    const name   = member?.displayName ?? targetUser.username;

    // カスタム背景パスをdataに注入
    const bgPath = getBgPath(targetUser.id);
    const cardData = { ...data, bgUrl: bgPath };

    const imgBuf = await generateRankCard(cardData, targetUser, rank);

    const current = Math.max(0, data.xp - (data.levelBase ?? data.xp));
    const embed = {
        author: {
            name: `${name}   ${badge.emoji} Lv.${data.level}`,
            icon_url: targetUser.displayAvatarURL({ size: 128 }),
        },
        description: `**${Math.floor(current)} / ${XP_PER_LEVEL} XP**　　🏆 **#${rank ?? '?'}**　　累計 **${Math.floor(data.xp).toLocaleString('en-US')} XP**`,
        image: { url: 'attachment://rank.png' },
        color: badge.color,
    };

    return replyTarget.reply({
        embeds: [embed],
        files: [{ attachment: imgBuf, name: 'rank.png' }],
    });
}

// ── /top ランキングembed ───────────────────────────────────────────────
const PERIOD_LABELS = { total: 'トータル', day: '本日', week: '今週', month: '今月' };
const MEDALS = ['🥇', '🥈', '🥉'];

async function buildTopEmbed(guild, period = 'total') {
    const board = period === 'total' ? getLeaderboard(10) : getLeaderboardByPeriod(period, 10);
    if (!board.length) return null;

    const lines = await Promise.all(board.map(async (e, i) => {
        const member  = await guild.members.fetch(e.id).catch(() => null);
        const name    = member?.displayName ?? `<@${e.id}>`;
        const badge   = getLevelBadge(e.level);
        const num     = MEDALS[i] ?? `\`${i + 1}\``;
        const dispXp  = period === 'total' ? Math.floor(e.xp) : Math.floor(e.periodXp);
        const xpStr   = dispXp.toLocaleString('en-US');
        return `${num} ${badge.emoji}**${e.level}** ${name} — ${xpStr} XP`;
    }));

    return {
        title: `🏆 XP ランキング TOP10　[${PERIOD_LABELS[period]}]`,
        description: lines.join('\n'),
        color: 0xf5a623,
        footer: { text: `全${getLeaderboard(9999).length}名` },
    };
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

    // !xp プレフィックスコマンド
    if (m.content.startsWith('!xp')) {
        const target = m.mentions.users.first() ?? m.author;
        try {
            await sendRankCard(m, target, m.guild);
        } catch (e) {
            console.error('[!xp Error]:', e);
        }
        return;
    }

    // 除外ロール確認
    if (isExcluded(m.member)) return;

    // XP処理
    const xpResult = processMessage(m.author.id, m.content);
    if (xpResult.newLevel !== null) {
        m.channel.send(`🎉 <@${m.author.id}> がレベル **${xpResult.newLevel}** に上がりました！ (累計 ${Math.floor(xpResult.xp).toLocaleString('ja-JP')} XP)`).catch(() => {});
        if (!isHideBadge(m.author.id)) {
            const member = m.member ?? await m.guild.members.fetch(m.author.id).catch(() => null);
            if (member?.manageable) {
                const base = member.nickname ?? member.user.username;
                member.setNickname(buildNickname(base, xpResult.newLevel)).catch(() => {});
            }
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
    if (i.isButton() && i.customId.startsWith('admin_reset:'))
        return handleAdminButton(i).catch(e => console.error('[AdminBtn]:', e));
    if (i.isStringSelectMenu() && i.customId === 'admin_servers:leave_select')
        return handleServersLeaveSelect(i).catch(e => console.error('[ServersSelect]:', e));
    if (i.isButton() && i.customId.startsWith('admin_servers:leave_confirm:'))
        return handleServersLeaveConfirm(i, i.customId.split(':')[2]).catch(e => console.error('[ServersConfirm]:', e));
    if (i.isButton() && i.customId === 'admin_servers:leave_cancel')
        return handleServersLeaveCancel(i).catch(e => console.error('[ServersCancel]:', e));

    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'imp')
        return handleImp(i).catch(e => console.error('[Imp Error]:', e));

    // ── 全員使用可能 ─────────────────────────────────────────────────

    if (i.commandName === 'rank') {
        try {
            await i.deferReply();
            const target = i.options.getUser('user') ?? i.user;
            const data   = getUserData(target.id);
            const rank   = getRank(target.id);
            const badge  = getLevelBadge(data.level);
            const member = await i.guild.members.fetch(target.id).catch(() => null);
            const name   = member?.displayName ?? target.username;
            const bgPath = getBgPath(target.id);
            const imgBuf  = await generateRankCard({ ...data, bgUrl: bgPath }, target, rank);
            const current = Math.max(0, data.xp - (data.levelBase ?? data.xp));
            return i.editReply({
                embeds: [{
                    author: { name: `${name}   ${badge.emoji} Lv.${data.level}`, icon_url: target.displayAvatarURL({ size: 128 }) },
                    description: `**${Math.floor(current)} / ${XP_PER_LEVEL} XP**　　🏆 **#${rank ?? '?'}**　　累計 **${Math.floor(data.xp).toLocaleString('en-US')} XP**`,
                    image: { url: 'attachment://rank.png' },
                    color: badge.color,
                }],
                files: [{ attachment: imgBuf, name: 'rank.png' }],
            });
        } catch (e) { console.error('[Rank Error]:', e); }
        return;
    }

    if (i.commandName === 'xp') {
        try {
            const sub    = i.options.getSubcommand();
            const hide   = sub === 'hide';
            setHideBadge(i.user.id, hide);
            const member = i.member;
            if (member?.manageable) {
                const base     = member.nickname ?? member.user.username;
                const stripped = base.replace(/\s*[🌱🔥⚡💎👑]\d+$/, '');
                const newNick  = hide ? stripped : buildNickname(stripped, getUserData(i.user.id).level);
                await member.setNickname(newNick).catch(() => {});
            }
            return i.reply({
                content: hide
                    ? '🙈 ニックネームのレベルバッジを非表示にしました。'
                    : '👁️ ニックネームのレベルバッジを表示に戻しました。',
                ephemeral: true,
            });
        } catch (e) { console.error('[xp cmd Error]:', e); }
        return;
    }

    if (i.commandName === 'top') {
        try {
            await i.deferReply();
            const period = i.options.getString('period') ?? 'total';
            const embed  = await buildTopEmbed(i.guild, period);
            if (!embed) return i.editReply({ content: 'まだデータがありません。' });
            return i.editReply({ embeds: [embed] });
        } catch (e) { console.error('[Top Error]:', e); }
        return;
    }

    if (i.commandName === 'setbg') {
        try {
            const attachment = i.options.getAttachment('image');
            const url        = i.options.getString('url');
            const src        = attachment?.url ?? url;
            if (!src) return i.reply({ content: '画像ファイルかURLを指定してください。', ephemeral: true });
            await i.deferReply({ ephemeral: true });
            await saveBgFromUrl(i.user.id, src);
            return i.editReply({ content: '✅ ランクカードの背景を設定しました！' });
        } catch (e) {
            console.error('[setbg Error]:', e);
            return i.editReply({ content: '❌ 画像の読み込みに失敗しました。別の画像を試してください。' });
        }
    }

    if (i.commandName === 'delbg') {
        deleteBg(i.user.id);
        return i.reply({ content: '🗑️ 背景画像をデフォルトに戻しました。', ephemeral: true });
    }

    // ── 管理者のみ ────────────────────────────────────────────────────

    if (!hasPermission(i.member))
        return i.reply({ content: 'このボットを使用する権限がありません。', ephemeral: true });

    try {
        if (i.commandName === 'timeoutlist') await handleTimeoutList(i);
        if (i.commandName === 'dice')        await handleDeathmatch(i);
        if (i.commandName === 'anon')        await handleAnon(i);
        if (i.commandName === 'curse')       await handleCurse(i);
        if (i.commandName === 'lurker')      await handleLurker(i);
        if (i.commandName === 'admin') {
            const sub = i.options.getSubcommand();
            if (sub === 'ngserver')      await handleNGServer(i);
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

        if (i.commandName === 'xpadmin') {
            const sub  = i.options.getSubcommand();
            const user = i.options.getUser('user');

            if (sub === 'set') {
                const level = i.options.getInteger('level');
                const u     = setUserLevel(user.id, level);
                // ニックネーム更新
                const member = await i.guild.members.fetch(user.id).catch(() => null);
                if (member?.manageable) {
                    const base = member.nickname ?? member.user.username;
                    await member.setNickname(buildNickname(base, level)).catch(() => {});
                }
                return i.reply({ content: `✅ <@${user.id}> をLv.**${level}** (${Math.floor(u.xp)} XP) に設定しました。`, ephemeral: true });
            }

            if (sub === 'add') {
                const amount = i.options.getInteger('amount');
                const u      = adjustXP(user.id, amount);
                const sign   = amount >= 0 ? '+' : '';
                const member = await i.guild.members.fetch(user.id).catch(() => null);
                if (member?.manageable) {
                    const base = member.nickname ?? member.user.username;
                    await member.setNickname(buildNickname(base, u.level)).catch(() => {});
                }
                return i.reply({ content: `✅ <@${user.id}> のXPを ${sign}${amount} 調整 → Lv.**${u.level}** / ${Math.floor(u.xp)} XP`, ephemeral: true });
            }

            if (sub === 'reset') {
                resetUser(user.id);
                const member = await i.guild.members.fetch(user.id).catch(() => null);
                if (member?.manageable) {
                    const stripped = (member.nickname ?? member.user.username).replace(/\s*[🌱🔥⚡💎👑]\d+$/, '');
                    await member.setNickname(stripped).catch(() => {});
                }
                return i.reply({ content: `✅ <@${user.id}> のXP・レベルをリセットしました。`, ephemeral: true });
            }

            if (sub === 'exclude') {
                const action = i.options.getString('action');
                const role   = i.options.getRole('role');
                if (action === 'add') {
                    addExcludedRole(role.id);
                    return i.reply({ content: `✅ ${role} をXP除外ロールに追加しました。`, ephemeral: true });
                }
                if (action === 'remove') {
                    removeExcludedRole(role.id);
                    return i.reply({ content: `✅ ${role} をXP除外ロールから解除しました。`, ephemeral: true });
                }
                if (action === 'list') {
                    const roles = getExcludedRoles();
                    const text  = roles.length ? roles.map(id => `<@&${id}>`).join('、') : 'なし';
                    return i.reply({ content: `📋 XP除外ロール: ${text}`, ephemeral: true });
                }
            }
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
