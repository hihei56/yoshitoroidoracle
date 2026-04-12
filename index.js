// index.js — Oracle Cloud対応版
process.on('uncaughtException',  e => console.error('[Error]:', e));
process.on('unhandledRejection', e => console.error('[Reject]:', e));

require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { initScheduler }          = require('./scheduler');
const { handleAnon }             = require('./anon');
const { handleCurse }            = require('./curse');
const { handleDeathmatch }       = require('./deathmatch');
const { handleModerator, handleImageDeleteButton } = require('./moderator');
const { handleAdmin, handleAdminButton } = require('./admin');
const { handleJoker }            = require('./joker');
const { initRSS }                = require('./rssBot');
const { postRanking, handleRanking } = require('./ranking');
const { handleTimeoutList }      = require('./timeoutlist');
const { initSecurity, handlePermList } = require('./security');

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
if (DEBUG_MODE) console.log('🐛 [Debug] デバッグモード有効');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

const ALLOWED_ROLES = ['1476944370694488134', '1478715790575538359'];

function hasPermission(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    return ALLOWED_ROLES.some(id => member.roles.cache.has(id));
}

client.once(Events.ClientReady, async c => {
    console.log(`✅ [Bot Ready] ${c.user.tag}`);
    console.log(`📁 DATA_DIR=${process.env.DATA_DIR ?? '(未設定・スクリプト同階層)'}`);

    initScheduler(client);
    initSecurity(client);

    initRSS(client);

    if (DEBUG_MODE) {
        postRanking(client).catch(e => console.error('[Ranking] 起動時エラー:', e));
        setInterval(() => {
            postRanking(client).catch(e => console.error('[Ranking] 定期更新エラー:', e));
        }, 60 * 60 * 1000);
    }
});

client.on(Events.MessageCreate, async m => {
    if (m.author.bot || !m.guild) return;
    handleModerator(m).catch(err => console.error('[Mod Error]:', err));
});

client.on(Events.InteractionCreate, async i => {
    // 画像削除ボタン（権限チェック不要・投稿者本人のみ許可はハンドラ内で処理）
    if (i.isButton() && i.customId.startsWith('del_img:')) {
        return handleImageDeleteButton(i).catch(e => console.error('[DelImg]:', e));
    }

    // 管理設定リセットボタン
    if (i.isButton() && i.customId.startsWith('admin_reset:')) {
        return handleAdminButton(i).catch(e => console.error('[AdminBtn]:', e));
    }

    if (!i.isChatInputCommand()) return;

    if (!hasPermission(i.member)) {
        return i.reply({ content: 'このボットを使用する権限がありません。', ephemeral: true });
    }

    try {
        if (i.commandName === 'timeoutlist') await handleTimeoutList(i);
        if (i.commandName === 'dice')        await handleDeathmatch(i);
        if (i.commandName === 'anon')        await handleAnon(i);
        if (i.commandName === 'curse')       await handleCurse(i);
        if (i.commandName === 'admin')       await handleAdmin(i);
        if (i.commandName === 'joker')       await handleJoker(i);
        if (i.commandName === 'permlist') await handlePermList(i);
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

// グレースフルシャットダウン（pm2 stop / SIGTERM 対応）
async function shutdown(signal) {
    console.log(`[Shutdown] ${signal} 受信 - 終了処理中...`);
    try { await client.destroy(); } catch {}
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

client.login(process.env.DISCORD_TOKEN);
