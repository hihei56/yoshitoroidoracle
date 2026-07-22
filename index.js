// index.js — Oracle Cloud対応版
process.on('uncaughtException',  e => console.error('[Error]:', e));
process.on('unhandledRejection', e => console.error('[Reject]:', e));

require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { handleAnon }             = require('./anon');
const { handleCurse }            = require('./curse');
const { initLurker, handleLurker } = require('./lurker');
const { initChatter, recordMessage: recordChatterMessage } = require('./chatter');
const { initTopicStarter } = require('./topic_starter');
const { initVCRecruit, recordVoiceStateForRecruit, handleVCRecruitButton } = require('./vc_recruit');
const { recordActivity, backfillActivity } = require('./activity_tracker');
const { handleDeathmatch }       = require('./deathmatch');
const { handleModerator, handlePoopReaction, handleCryReaction, handleEmbedModerator, handleCandyReaction, handleEditDM } = require('./moderator');
const { handleSpamEnforcerButton, checkFloodSpam } = require('./spam_enforcer');
const { handleImpersonate }      = require('./impersonate');
const { handleImp }              = require('./imp');
const { handleAdmin, handleAdmin2, handleAdminButton, handleServersLeaveSelect, handleServersLeaveConfirm, handleServersLeaveCancel, handlePresence, restorePresence } = require('./admin');
const { initRSS }                = require('./rssBot');
const {
    initBump, handleBumpMessage, handleBumpSetup,
    handleBumpStatus, handleBumpForceNotify, handleBumpHistory,
}                                 = require('./bump');
const { handleTimeout }           = require('./timeout');
const { handleClean }              = require('./clean');
const { handleNekoclear, handleNekoclearConfirm, handleNekoclearCancel } = require('./nekoclear');
const {
    handleYomiageMessage, handleYomiageJoin, handleYomiageLeave, handleYomiageVoice,
}                                   = require('./yomiage');
const { checkImageAttachments }    = require('./image_spam_filter');
const { checkLongText }            = require('./long_text_filter');
const { initShiritori, handleShiritoriMessage } = require('./shiritori');
const { handleRtaMessage } = require('./rta');
const { initXpAnnounce }          = require('./xp_announce');
const { postRanking, handleRanking } = require('./ranking');
const { handleTimeoutList }      = require('./timeoutlist');
const { initSecurity, handlePermList } = require('./security');
const { handleInviteFilter, handleNGServer } = require('./invite_filter');
const { handleEditMonitor } = require('./edit_monitor');
const { generateRankCard, saveBgFromUrl, saveBgFromAttachment, deleteBg, getBgPath } = require('./rankCard');
const {
    handleVoicePanel, handleVoicePanelVoiceState, handleVoicePanelButton,
    handleVoicePanelSelect, handleVoicePanelUserSelect, handleVoicePanelModal,
    handleVoiceBan, initVoicePanelCleanup,
} = require('./voice_panel');
const {
    XP_PER_LEVEL,
    processMessage, getUserData, getRank, getLeaderboard, xpToNextLevel,
    getPeriodXp, getLeaderboardByPeriod,
    setUserLevel, adjustXP, resetUser, transferUser,
    setHideBadge, isHideBadge,
    addExcludedRole, removeExcludedRole, getExcludedRoles, isExcluded,
    buildNickname, getLevelBadge, getMonthlyRank,
    setAlias, getAlias,
    setMonthOverride, getMonthOverride,
    toggleMonthShift, getMonthShift, getSeasonStart,
    setLevelNotif, getLevelNotif,
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
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const ALLOWED_ROLES = ['1476944370694488134', '1478715790575538359'];
const ADMIN_ROLE_ID = '1495971497016164492';

function hasPermission(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
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
    const cardData = { ...data, bgUrl: bgPath, displayName: name };

    const imgBuf = await generateRankCard(cardData, targetUser, rank);

    return replyTarget.reply({
        files: [{ attachment: imgBuf, name: 'rank.png' }],
    });
}

// ── /top ランキングembed ───────────────────────────────────────────────
const PERIOD_LABELS = { total: 'トータル', day: '今日', week: '今週', month: '今月' };
const PERIOD_SUBLABELS = { total: 'トータルXPスコア', day: '今日のXPスコア', week: '今週のXPスコア', month: '今月のXPスコア' };

async function buildTopEmbed(guild, period = 'total') {
    const board = period === 'total' ? getLeaderboard(10) : getLeaderboardByPeriod(period, 10);
    if (!board.length) return null;

    const total = getLeaderboard(9999).length;
    const lines = board.map((e, i) => {
        const dispXp = period === 'total' ? Math.floor(e.xp) : Math.floor(e.periodXp);
        const xpStr  = dispXp.toLocaleString('en-US');
        return `**#${i + 1}** <@${e.id}> XP: ${xpStr}`;
    });

    return {
        author: { name: 'ギルドスコアランキング', icon_url: guild.iconURL() ?? undefined },
        description: `${PERIOD_SUBLABELS[period]} [1/${total}]\n\n${lines.join('\n')}`,
        color: 0x57f287,
        footer: { text: guild.name, icon_url: guild.iconURL() ?? undefined },
        timestamp: new Date().toISOString(),
    };
}

client.once(Events.ClientReady, async c => {
    console.log(`✅ [Bot Ready] ${c.user.tag}`);
    console.log(`📁 DATA_DIR=${process.env.DATA_DIR ?? '(未設定・スクリプト同階層)'}`);

    initSecurity(client);
    initRSS(client);
    initLurker(client);
    initChatter(client);
    initTopicStarter(client);
    initVCRecruit(client);
    initVoicePanelCleanup(client);
    initBump(client);
    initShiritori();
    initXpAnnounce(client);
    restorePresence(client).catch(e => console.error('[PRESENCE] 復元エラー:', e));

    const guild = client.guilds.cache.first();
    if (guild) backfillActivity(guild).catch(e => console.error('[Activity] バックフィルエラー:', e));

    // 月間ランキングニックネーム 6時間ごと自動更新（上位10人のみ）
    async function syncMonthlyNicks(trigger = 'manual') {
        const g = client.guilds.cache.first();
        if (!g) return;
        const board = getLeaderboard(10);
        let ok = 0, skip = 0, fail = 0;
        for (const e of board) {
            if (isHideBadge(e.id)) { skip++; continue; }
            const member = await g.members.fetch(e.id).catch(() => null);
            if (!member) { skip++; continue; }
            if (!member.manageable) {
                console.log(`[NickSync] SKIP manageable=false uid=${e.id} name=${member.displayName}`);
                skip++; continue;
            }
            const mRank   = getMonthlyRank(e.id);
            const base    = getAlias(e.id) ?? member.displayName;
            const newNick = buildNickname(base, e.level, mRank, e.id);
            const err = await member.setNickname(newNick).then(() => null).catch(e => e);
            if (err) {
                console.error(`[NickSync] FAIL uid=${e.id} nick=${newNick} err=${err.message}`);
                fail++;
            } else {
                console.log(`[NickSync] OK uid=${e.id} nick=${newNick}`);
                ok++;
            }
        }
        console.log(`[NickSync] 完了(${trigger}): OK=${ok} SKIP=${skip} FAIL=${fail}`);
    }
    syncMonthlyNicks('startup').catch(e => console.error('[NickSync] 起動時エラー:', e));
    setInterval(() => syncMonthlyNicks('6hourly').catch(e => console.error('[NickSync] エラー:', e)), 6 * 60 * 60 * 1000);

    if (DEBUG_MODE) {
        postRanking(client).catch(e => console.error('[Ranking] 起動時エラー:', e));
        setInterval(() => {
            postRanking(client).catch(e => console.error('[Ranking] 定期更新エラー:', e));
        }, 60 * 60 * 1000);
    }
});

client.on(Events.MessageCreate, async m => {
    if (m.author.bot) {
        handleBumpMessage(m).catch(e => console.error('[Bump Error]:', e));
        return;
    }
    if (!m.guild) {
        handleEditDM(m).catch(e => console.error('[EditDM Error]:', e));
        return;
    }

    recordActivity(m.author.id);
    recordChatterMessage(m.channel.id);
    handleInviteFilter(m, client).catch(err => console.error('[InviteFilter Error]:', err));
    handleModerator(m).catch(err => console.error('[Mod Error]:', err));
    handleShiritoriMessage(m).catch(err => console.error('[Shiritori Error]:', err));
    handleRtaMessage(m).catch(err => console.error('[RTA Error]:', err));
    checkImageAttachments(m).catch(err => console.error('[ImageSpam Error]:', err));
    checkLongText(m).catch(err => console.error('[LongTextFilter Error]:', err));
    checkFloodSpam(m).catch(err => console.error('[SpamEnforcer Flood Error]:', err));
    handleYomiageMessage(m).catch(err => console.error('[Yomiage Error]:', err));

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
        if (getLevelNotif()) {
            m.channel.send(`🎉 <@${m.author.id}> がレベル **${xpResult.newLevel}** に上がりました！ (累計 ${Math.floor(xpResult.xp).toLocaleString('ja-JP')} XP)`).catch(() => {});
        }
        if (!isHideBadge(m.author.id)) {
            const member = m.member ?? await m.guild.members.fetch(m.author.id).catch(() => null);
            if (member?.manageable) {
                const base = member.displayName;
                const mRank = getMonthlyRank(m.author.id);
                member.setNickname(buildNickname(base, xpResult.newLevel, mRank, m.author.id)).catch(e => console.error('[Nick Error]', e.message));
            } else {
                console.log(`[Nick Skip] manageable=false for ${m.author.id}`);
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

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoicePanelVoiceState(oldState, newState).catch(e => console.error('[VoicePanel VC]:', e));
    recordVoiceStateForRecruit(newState.guild);
});

client.on(Events.InteractionCreate, async i => {
    if (i.isButton() && i.customId.startsWith('admin_reset:'))
        return handleAdminButton(i).catch(e => console.error('[AdminBtn]:', e));
    if (i.isButton() && i.customId.startsWith('spamenf_'))
        return handleSpamEnforcerButton(i).catch(e => console.error('[SpamEnforcerBtn]:', e));
    if (i.isStringSelectMenu() && i.customId === 'admin_servers:leave_select')
        return handleServersLeaveSelect(i).catch(e => console.error('[ServersSelect]:', e));
    if (i.isButton() && i.customId.startsWith('admin_servers:leave_confirm:'))
        return handleServersLeaveConfirm(i, i.customId.split(':')[2]).catch(e => console.error('[ServersConfirm]:', e));
    if (i.isButton() && i.customId === 'admin_servers:leave_cancel')
        return handleServersLeaveCancel(i).catch(e => console.error('[ServersCancel]:', e));

    if (i.isButton() && i.customId.startsWith('nekoclear_confirm:'))
        return handleNekoclearConfirm(i, i.customId.split(':')[1]).catch(e => console.error('[NekoclearConfirm]:', e));
    if (i.isButton() && i.customId.startsWith('nekoclear_cancel:'))
        return handleNekoclearCancel(i, i.customId.split(':')[1]).catch(e => console.error('[NekoclearCancel]:', e));

    if (i.isButton() && i.customId === 'vcrecruit_press')
        return handleVCRecruitButton(i).catch(e => console.error('[VCRecruit Btn]:', e));

    if (i.isButton() && i.customId.startsWith('vcpanel_'))
        return handleVoicePanelButton(i).catch(e => console.error('[VoicePanel Btn]:', e));
    if (i.isStringSelectMenu() && i.customId === 'vcpanel_userlimit')
        return handleVoicePanelSelect(i).catch(e => console.error('[VoicePanel Select]:', e));
    if (i.isUserSelectMenu() && i.customId.startsWith('vcpanel_um_select_'))
        return handleVoicePanelUserSelect(i).catch(e => console.error('[VoicePanel UserSelect]:', e));
    if (i.isModalSubmit() && i.customId.startsWith('vcpanel_modal_'))
        return handleVoicePanelModal(i).catch(e => console.error('[VoicePanel Modal]:', e));

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
            const imgBuf  = await generateRankCard({ ...data, bgUrl: bgPath, displayName: name }, target, rank);
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
                const base     = getAlias(i.user.id) ?? member.displayName;
                const stripped = base.replace(/\s*[🌱🔥⚡💎👑].*$/, '');
                let newNick;
                if (hide) {
                    newNick = stripped;
                } else {
                    const mRank = getMonthlyRank(i.user.id);
                    newNick = buildNickname(stripped, getUserData(i.user.id).level, mRank, i.user.id);
                }
                await member.setNickname(newNick).catch(e => console.error('[xp hide nick]:', e.message));
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

    if (i.commandName === 'bump-setup')        return handleBumpSetup(i);
    if (i.commandName === 'bump-status')       return handleBumpStatus(i);
    if (i.commandName === 'bump-force-notify') return handleBumpForceNotify(i);
    if (i.commandName === 'bump-history')      return handleBumpHistory(i);
    if (i.commandName === 'timeout')           return handleTimeout(i);
    if (i.commandName === 'clean')              return handleClean(i);
    if (i.commandName === 'yomiage-join')       return handleYomiageJoin(i);
    if (i.commandName === 'yomiage-leave')      return handleYomiageLeave(i);
    if (i.commandName === 'yomiage-voice')      return handleYomiageVoice(i);

    // ── 管理者のみ ────────────────────────────────────────────────────

    if (!hasPermission(i.member))
        return i.reply({ content: 'このボットを使用する権限がありません。', ephemeral: true });

    try {
        if (i.commandName === 'timeoutlist') await handleTimeoutList(i);
        if (i.commandName === 'nekoclear')   await handleNekoclear(i);
        if (i.commandName === 'dice')        await handleDeathmatch(i);
        if (i.commandName === 'anon')        await handleAnon(i);
        if (i.commandName === 'curse')       await handleCurse(i);
        if (i.commandName === 'lurker')      await handleLurker(i);
        if (i.commandName === 'admin2') await handleAdmin2(i);
        if (i.commandName === 'admin') {
            const sub = i.options.getSubcommand();
            if (sub === 'ngserver')        await handleNGServer(i);
            else if (sub === 'presence')   await handlePresence(i);
            else if (sub === 'voice_ban')  await handleVoiceBan(i);
            else                           await handleAdmin(i);
        }
        if (i.commandName === 'permlist')    await handlePermList(i);
        if (i.commandName === 'impersonate') await handleImpersonate(i);
        if (i.commandName === 'voicepanel')  await handleVoicePanel(i);
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
                const member = await i.guild.members.fetch(user.id).catch(() => null);
                if (member?.manageable) {
                    const base = getAlias(user.id) ?? member.displayName;
                    const stripped = base.replace(/\s*[🌱🔥⚡💎👑].*$/, '');
                    await member.setNickname(buildNickname(stripped, level, getMonthlyRank(user.id), user.id)).catch(() => {});
                }
                return i.reply({ content: `✅ <@${user.id}> をLv.**${level}** (${Math.floor(u.xp)} XP) に設定しました。`, ephemeral: true });
            }

            if (sub === 'add') {
                const amount = i.options.getInteger('amount');
                const u      = adjustXP(user.id, amount);
                const sign   = amount >= 0 ? '+' : '';
                const member = await i.guild.members.fetch(user.id).catch(() => null);
                if (member?.manageable) {
                    const base = getAlias(user.id) ?? member.displayName;
                    const stripped = base.replace(/\s*[🌱🔥⚡💎👑].*$/, '');
                    await member.setNickname(buildNickname(stripped, u.level, getMonthlyRank(user.id), user.id)).catch(() => {});
                }
                return i.reply({ content: `✅ <@${user.id}> のXPを ${sign}${amount} 調整 → Lv.**${u.level}** / ${Math.floor(u.xp)} XP`, ephemeral: true });
            }

            if (sub === 'reset') {
                resetUser(user.id);
                const member = await i.guild.members.fetch(user.id).catch(() => null);
                if (member?.manageable) {
                    const base = getAlias(user.id) ?? member.displayName;
                    const stripped = base.replace(/\s*[🌱🔥⚡💎👑].*$/, '');
                    await member.setNickname(stripped).catch(() => {});
                }
                return i.reply({ content: `✅ <@${user.id}> のXP・レベルをリセットしました。`, ephemeral: true });
            }

            if (sub === 'setmonth') {
                const on = toggleMonthShift();
                const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
                if (on) {
                    const seasonStart = getSeasonStart();
                    const [sy, sm] = seasonStart.split('-').map(Number);
                    const endMonth = new Date(sy, sm, 1).toISOString().slice(0, 7); // 翌月
                    return i.reply({
                        content: `✅ シーズン延長モードにしました。**${seasonStart}** シーズンを **${endMonth}** 末まで延長します。`,
                        ephemeral: true,
                    });
                } else {
                    const currentYM = now.toISOString().slice(0, 7);
                    return i.reply({
                        content: `✅ 通常モードに戻しました。今月のXPは **${currentYM}** 分としてカウントされます。`,
                        ephemeral: true,
                    });
                }
            }

            if (sub === 'alias') {
                const user  = i.options.getUser('user');
                const alias = i.options.getString('name');
                setAlias(user.id, alias || null);
                if (alias) {
                    return i.reply({ content: `✅ <@${user.id}> の通称を **${alias}** に設定しました。`, ephemeral: true });
                } else {
                    return i.reply({ content: `✅ <@${user.id}> の通称をリセットしました。`, ephemeral: true });
                }
            }

            if (sub === 'hidebadge') {
                const hide   = i.options.getBoolean('hide');
                const user   = i.options.getUser('user');
                const role   = i.options.getRole('role');
                if (!user && !role) {
                    return i.reply({ content: '❌ `user` または `role` のどちらかを指定してください。', ephemeral: true });
                }
                await i.deferReply({ ephemeral: true });

                async function applyHide(member) {
                    setHideBadge(member.id, hide);
                    if (!member.manageable) return;
                    const base     = getAlias(member.id) ?? member.displayName;
                    const stripped = base.replace(/\s*[🌱🔥⚡💎👑].*$/, '');
                    const newNick  = hide
                        ? stripped
                        : buildNickname(stripped, getUserData(member.id).level, getMonthlyRank(member.id), member.id);
                    await member.setNickname(newNick).catch(e => console.error('[hidebadge nick]:', e.message));
                }

                if (user) {
                    const member = await i.guild.members.fetch(user.id).catch(() => null);
                    if (member) await applyHide(member);
                    return i.editReply({
                        content: hide
                            ? `✅ <@${user.id}> のバッジを非表示にしました。`
                            : `✅ <@${user.id}> のバッジを表示に戻しました。`,
                    });
                }

                // ロール指定
                const members = await i.guild.members.fetch();
                const targets = members.filter(m => m.roles.cache.has(role.id));
                let ok = 0;
                for (const m of targets.values()) { await applyHide(m); ok++; }
                return i.editReply({
                    content: hide
                        ? `✅ ロール **${role.name}** の ${ok} 人のバッジを非表示にしました。`
                        : `✅ ロール **${role.name}** の ${ok} 人のバッジを表示に戻しました。`,
                });
            }

            if (sub === 'levelnotif') {
                const enable = i.options.getBoolean('enable');
                setLevelNotif(enable);
                return i.reply({
                    content: enable
                        ? '✅ レベルアップ通知を **ON** にしました。'
                        : '✅ レベルアップ通知を **OFF** にしました。',
                    ephemeral: true,
                });
            }

            if (sub === 'syncnicks') {
                await i.deferReply({ ephemeral: true });
                const board = getLeaderboard(9999);
                let ok = 0, skip = 0, fail = 0;
                for (const e of board) {
                    if (isHideBadge(e.id)) { skip++; continue; }
                    const member = await i.guild.members.fetch(e.id).catch(() => null);
                    if (!member) { skip++; continue; }
                    if (!member.manageable) { skip++; continue; }
                    const base   = getAlias(e.id) ?? member.displayName;
                    const mRank  = getMonthlyRank(e.id);
                    const err = await member.setNickname(buildNickname(base, e.level, mRank, e.id)).then(() => null).catch(e => e);
                    if (err) { fail++; console.error('[syncnicks]', e.id, err.message); }
                    else ok++;
                }
                return i.editReply({ content: `✅ ニックネーム同期完了: 更新 ${ok}名 / スキップ ${skip}名 / 失敗 ${fail}名` });
            }

            if (sub === 'transfer') {
                const fromId = i.options.getString('from_id').trim();
                const toUser = i.options.getUser('to');
                if (!/^\d{17,20}$/.test(fromId)) {
                    return i.reply({ content: '❌ `from_id` に有効なユーザーIDを入力してください（17〜20桁の数字）。', ephemeral: true });
                }
                if (fromId === toUser.id) {
                    return i.reply({ content: '❌ 引き継ぎ元と引き継ぎ先が同じユーザーです。', ephemeral: true });
                }
                const src = getUserData(fromId);
                if (src.xp === 0 && src.level === 0) {
                    return i.reply({ content: `❌ ID \`${fromId}\` のXPデータが存在しません。`, ephemeral: true });
                }
                const result = transferUser(fromId, toUser.id);
                const member = await i.guild.members.fetch(toUser.id).catch(() => null);
                if (member?.manageable) {
                    const base     = getAlias(toUser.id) ?? member.displayName;
                    const stripped = base.replace(/\s*[🌱🔥⚡💎👑].*$/, '');
                    await member.setNickname(buildNickname(stripped, result.level, getMonthlyRank(toUser.id), toUser.id)).catch(() => {});
                }
                return i.reply({
                    content: `✅ \`${fromId}\` のデータを <@${toUser.id}> に引き継ぎました。\nLv.**${result.level}** / ${Math.floor(result.xp)} XP`,
                    ephemeral: true,
                });
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
