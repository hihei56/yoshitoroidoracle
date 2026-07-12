// yomiage.js — ボイスチャンネル読み上げBot（ひろゆき/岡田斗司夫ボイス + 声優ボイス）
const { Readable } = require('stream');
const { ChannelType, PermissionsBitField } = require('discord.js');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    entersState, VoiceConnectionStatus, AudioPlayerStatus, StreamType,
} = require('@discordjs/voice');
const { synthesize: synthesizeCoefont } = require('./coefont_tts');
const { synthesize: synthesizeEngine, listSpeakers } = require('./engine_tts');
const { getSettings, saveSettings } = require('./config');

const DEFAULT_VOICE  = 'hiroyuki';
const MAX_READ_LENGTH = 100;
const ENGINE_VOICE_PREFIX = 'engine:';

const guildStates = new Map(); // guildId -> { connection, player, textChannelId, queue, playing }

function sanitizeForSpeech(content) {
    return content
        .replace(/https?:\/\/\S+/g, 'URL')
        .replace(/<a?:(\w+):\d+>/g, ':$1:')
        .replace(/<@!?\d+>/g, 'メンション')
        .replace(/<@&\d+>/g, 'ロールメンション')
        .replace(/<#\d+>/g, 'チャンネル')
        .trim()
        .slice(0, MAX_READ_LENGTH);
}

function getUserVoice(userId) {
    const settings = getSettings();
    return settings.ttsUserVoices?.[userId] ?? DEFAULT_VOICE;
}

function setUserVoice(userId, voice) {
    const settings = getSettings();
    if (!settings.ttsUserVoices) settings.ttsUserVoices = {};
    settings.ttsUserVoices[userId] = voice;
    saveSettings(settings);
}

function cleanupGuild(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return;
    try { state.connection.destroy(); } catch {}
    guildStates.delete(guildId);
}

async function processQueue(guildId) {
    const state = guildStates.get(guildId);
    if (!state || state.playing || state.queue.length === 0) return;

    state.playing = true;
    const { text, voice } = state.queue.shift();

    try {
        const wavBuffer = voice.startsWith(ENGINE_VOICE_PREFIX)
            ? await synthesizeEngine(text, voice.slice(ENGINE_VOICE_PREFIX.length))
            : await synthesizeCoefont(text, voice);
        if (wavBuffer) {
            const resource = createAudioResource(Readable.from(wavBuffer), { inputType: StreamType.Arbitrary });
            state.player.play(resource);
            await entersState(state.player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
            await entersState(state.player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
        }
    } catch (e) {
        console.error('[Yomiage] 読み上げエラー:', e.message);
    } finally {
        state.playing = false;
        processQueue(guildId);
    }
}

async function handleYomiageMessage(message) {
    try {
        if (message.author.bot || !message.guild) return;

        const state = guildStates.get(message.guild.id);
        if (!state || message.channel.id !== state.textChannelId) return;

        const text = sanitizeForSpeech(message.content || '');
        if (!text) return;

        const voice = getUserVoice(message.author.id);
        state.queue.push({ text, voice });
        if (state.queue.length > 20) state.queue.shift(); // 溜まりすぎたら古い方から間引く

        processQueue(message.guild.id);
    } catch (e) {
        console.error('[Yomiage] メッセージ処理エラー:', e);
    }
}

async function handleYomiageJoin(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
            return interaction.reply({ content: '❌ 先にボイスチャンネルに参加してください。', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        const perms = me?.permissionsIn(voiceChannel);
        if (!perms?.has(PermissionsBitField.Flags.Connect) || !perms?.has(PermissionsBitField.Flags.Speak)) {
            return interaction.reply({ content: '❌ Botに「接続」「発言」権限が必要です。', ephemeral: true });
        }

        cleanupGuild(interaction.guild.id);

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: true,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

        const player = createAudioPlayer();
        connection.subscribe(player);

        connection.on(VoiceConnectionStatus.Disconnected, () => cleanupGuild(interaction.guild.id));

        guildStates.set(interaction.guild.id, {
            connection,
            player,
            textChannelId: interaction.channel.id,
            queue: [],
            playing: false,
        });

        return interaction.reply({
            content: `✅ ${voiceChannel} に参加し、このチャンネルのメッセージを読み上げます。\n声を変更するには \`/yomiage-voice\` を使ってください。`,
        });
    } catch (e) {
        console.error('[Yomiage] join エラー:', e);
        cleanupGuild(interaction.guildId);
        return interaction.reply({ content: '❌ ボイスチャンネルへの参加に失敗しました。', ephemeral: true }).catch(() => {});
    }
}

async function handleYomiageLeave(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!guildStates.has(interaction.guild.id)) {
            return interaction.reply({ content: 'ℹ️ ボイスチャンネルに参加していません。', ephemeral: true });
        }
        cleanupGuild(interaction.guild.id);
        return interaction.reply({ content: '👋 ボイスチャンネルから退出しました。' });
    } catch (e) {
        console.error('[Yomiage] leave エラー:', e);
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

const BUILTIN_VOICE_LABELS = {
    hiroyuki: 'ひろゆき',
    toshio:   '岡田斗司夫',
};

async function handleYomiageVoice(interaction) {
    try {
        const voice = interaction.options.getString('voice');

        let label = BUILTIN_VOICE_LABELS[voice];
        if (!label && voice.startsWith(ENGINE_VOICE_PREFIX)) {
            const styleId = Number(voice.slice(ENGINE_VOICE_PREFIX.length));
            const speakers = await listSpeakers().catch(() => []);
            label = speakers.find(s => s.styleId === styleId)?.label;
        }
        if (!label) {
            return interaction.reply({ content: '❌ 候補一覧から声を選択してください。', ephemeral: true });
        }

        setUserVoice(interaction.user.id, voice);
        return interaction.reply({ content: `✅ あなたの読み上げボイスを **${label}** に設定しました。`, ephemeral: true });
    } catch (e) {
        console.error('[Yomiage] voice エラー:', e);
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

async function handleYomiageVoiceAutocomplete(interaction) {
    try {
        const focused = interaction.options.getFocused().toLowerCase();

        const choices = Object.entries(BUILTIN_VOICE_LABELS)
            .map(([value, name]) => ({ name, value }));

        try {
            const speakers = await listSpeakers();
            for (const s of speakers) {
                choices.push({ name: s.label, value: `${ENGINE_VOICE_PREFIX}${s.styleId}` });
            }
        } catch (e) {
            // エンジン未起動時は組み込みボイスのみ表示
        }

        const filtered = choices
            .filter(c => c.name.toLowerCase().includes(focused))
            .slice(0, 25);

        return interaction.respond(filtered);
    } catch (e) {
        console.error('[Yomiage] voice autocomplete エラー:', e);
        return interaction.respond([]).catch(() => {});
    }
}

module.exports = {
    handleYomiageMessage, handleYomiageJoin, handleYomiageLeave,
    handleYomiageVoice, handleYomiageVoiceAutocomplete,
};
