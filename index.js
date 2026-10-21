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
const { handleChatlog } = require('./chatlog');
const {
    handleYomiageMessage, handleYomiageJoin, handleYomiageLeave, handleYomiageVoice,
}                                   = require('./yomiage');
const { checkImageAttachments }    = require('./image_spam_filter');
const { checkLongText }            = require('./long_text_filter');
const { initShiritori, handleShiritoriMessage } = require('./shiritori');
const { handleRtaMessage } = require('./rta');
const { postRanking, handleRanking } = require('./ranking');
const { handleTimeoutList }      = require('./timeoutlist');
const { initSecurity, handlePermList } = require('./security');
const { handleInviteFilter, handleNGServer } = require('./invite_filter');
const { handleEditMonitor } = require('./edit_monitor');
const {
    handleVoicePanel, handleVoicePanelVoiceState, handleVoicePanelButton,
    handleVoicePanelSelect, handleVoicePanelUserSelect, handleVoicePanelModal,
    handleVoiceBan, initVoicePanelCleanup,
} = require('./voice_panel');
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
        if (i.commandName === 'chatlog')     await handleChatlog(i);
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
