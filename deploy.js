require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    // 1. ダイス勝負
    new SlashCommandBuilder()
        .setName('dice')
        .setDescription('1日1回のダイス勝負。当たると制限がかかる場合があります。'),

    // 2. JOKERシステム
    new SlashCommandBuilder()
        .setName('joker')
        .setDescription('JOKERを実行。一か八かの制裁を下します。'),

    // 3. 匿名発言機能
    new SlashCommandBuilder()
        .setName('anon')
        .setDescription('匿名の〇〇として発言します。名前は24時間固定。')
        .addStringOption(option =>
            option.setName('content')
                .setDescription('メッセージ内容（必須）')
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('添付画像')
        )
        .addStringOption(option =>
            option.setName('reply_link')
                .setDescription('返信先メッセージのリンク')
        ),
// 4. lurkerなりすまし発言
new SlashCommandBuilder()
    .setName('imp')
    .setDescription('lurkerになりすまして発言します。')

    .addStringOption(option =>
        option.setName('content')
            .setDescription('メッセージ内容（必須）')
            .setRequired(true)
    )

    .addAttachmentOption(option =>
        option.setName('file')
            .setDescription('添付画像')
    )

    .addStringOption(option =>
        option.setName('reply_link')
            .setDescription('返信先メッセージのリンク')
    )

    .addBooleanOption(option =>
        option.setName('sticky')
            .setDescription('24時間同じlurkerに固定する')
    ),
    // 5. 管理機能
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('管理設定。サブコマンドを選択してください。')
        .addSubcommand(subcommand =>
            subcommand
                .setName('mod_skip')
                .setDescription('ユーザー/ロールを検閲除外に設定します。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('追加か解除を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add' },
                            { name: '解除', value: 'remove' }
                        )
                )
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象のユーザー（ロールと併用可）')
                )
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('対象のロール（ユーザーと併用可）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('say_deny')
                .setDescription('ユーザー/ロールのSay代行権限を管理します。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('拒否か許可を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '拒否', value: 'deny' },
                            { name: '許可', value: 'allow' }
                        )
                )
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象のユーザー（ロールと併用可）')
                )
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('対象のロール（ユーザーと併用可）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('say_channel')
                .setDescription('/say を許可するチャンネルを管理します。未設定時は全チャンネルで使用可能。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('追加か解除を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add' },
                            { name: '解除', value: 'remove' }
                        )
                )
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('対象チャンネル')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('log_channel')
                .setDescription('/anon の実行ログを送るチャンネルを設定します。未指定で解除。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('ログ送信先チャンネル（省略で解除）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('lurker_channel')
                .setDescription('ROM専目覚ましの自動投稿チャンネルを設定します。未指定で解除。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('投稿先チャンネル（省略で解除）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('現在の管理設定を表示します。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('chinese_thinker')
                .setDescription('NGワード検知時の中国思想家への置き換えをON/OFF・例外ユーザー管理します。')
                .addBooleanOption(opt =>
                    opt.setName('enable')
                        .setDescription('true=有効 / false=無効（action未指定時に使用）')
                )
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('例外ユーザー操作')
                        .addChoices(
                            { name: '例外に追加', value: 'add'    },
                            { name: '例外から解除', value: 'remove' },
                            { name: '例外一覧',   value: 'list'   },
                        )
                )
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('対象ユーザー（add/remove時に必須）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('cry_allow')
                .setDescription('😿リアクションによるWebhook化を許可するユーザーを管理します。')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('操作を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '許可', value: 'add'    },
                            { name: '解除', value: 'remove' },
                            { name: '一覧', value: 'list'   },
                        )
                )
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('対象ユーザー（add/remove時に必須）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('servers')
                .setDescription('ボットが加入しているサーバー一覧を表示し、退出操作ができます。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('kick_inactive')
                .setDescription('2週間無活動かつ保護ロールなしのメンバーをキックします（管理者のみ）。')
                .addBooleanOption(opt =>
                    opt.setName('dry_run')
                        .setDescription('true=対象確認のみ（デフォルト）/ false=実際にキック')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('presence')
                .setDescription('ボットのオンライン状態を変更します。')
                .addStringOption(opt =>
                    opt.setName('status')
                        .setDescription('設定するステータス')
                        .setRequired(true)
                        .addChoices(
                            { name: '🟢 オンライン',   value: 'online'    },
                            { name: '🌙 退席中',       value: 'idle'      },
                            { name: '⛔ 取り込み中',   value: 'dnd'       },
                            { name: '⚫ オフライン',   value: 'invisible' },
                            { name: '📱 モバイル',     value: 'mobile'    },
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('ngserver')
                .setDescription('招待リンクを自動削除するNGサーバーを管理します。')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('操作を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add'    },
                            { name: '削除', value: 'remove' },
                            { name: '一覧', value: 'list'   },
                        )
                )
                .addStringOption(opt =>
                    opt.setName('server_id')
                        .setDescription('NGにするサーバーID、または招待リンク（追加・削除時は必須）')
                )
        ),

    // 6. ROM専目覚まし（管理者のみ）
    new SlashCommandBuilder()
        .setName('lurker')
        .setDescription('3週間以上活動がないメンバーをランダムに4〜7名メンション（管理者のみ）。')
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('投稿先チャンネル（省略時は設定済みチャンネル）')
        )
        .addBooleanOption(opt =>
            opt.setName('force')
                .setDescription('クールダウン無視して強制実行')
        ),

    // 7. 呪いコマンド（管理者のみ）
    new SlashCommandBuilder()
        .setName('curse')
        .setDescription('ユーザーのメッセージを呪います（管理者のみ）。')
        .addStringOption(opt =>
            opt.setName('action')
                .setDescription('操作を選択')
                .setRequired(true)
                .addChoices(
                    { name: '🩸 呪いをかける', value: 'add'    },
                    { name: '✨ 呪いを解く',   value: 'remove' },
                    { name: '📋 一覧を見る',   value: 'list'   },
                )
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('対象ユーザー（list以外は必須）')
        ),

    // 8. なりすましコマンド（管理者のみ）
    new SlashCommandBuilder()
        .setName('impersonate')
        .setDescription('ユーザーの発言をROM専のなりすましにします（管理者のみ）。')
        .addStringOption(opt =>
            opt.setName('action')
                .setDescription('操作を選択')
                .setRequired(true)
                .addChoices(
                    { name: '🎭 なりすましをかける', value: 'add'    },
                    { name: '✨ なりすましを解く',   value: 'remove' },
                    { name: '📋 一覧を見る',         value: 'list'   },
                )
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('対象ユーザー（list以外は必須）')
        ),

    // 9. ランキング（デバッグモード時のみ有効）
    new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('配信者の同時接続数ランキングを今すぐ更新する（デバッグモード限定）'),

    // 10. タイムアウト一覧・延長
    new SlashCommandBuilder()
        .setName('timeoutlist')
        .setDescription('現在タイムアウト中のメンバーを一覧表示し、タイムアウトを延長できます。'),

    // 11. 危険権限保持者一覧
    new SlashCommandBuilder()
        .setName('permlist')
        .setDescription('危険な権限を持つロール・メンバーを一覧表示します。'),

    // 12. ランクカード背景設定（全員）
    new SlashCommandBuilder()
        .setName('setbg')
        .setDescription('ランクカードの背景画像を設定します。')
        .addAttachmentOption(opt => opt.setName('image').setDescription('背景にする画像ファイル'))
        .addStringOption(opt => opt.setName('url').setDescription('背景にする画像のURL')),

    new SlashCommandBuilder()
        .setName('delbg')
        .setDescription('ランクカードの背景をデフォルトに戻します。'),

    // 13. レベルバッジ表示切替（全員）
    new SlashCommandBuilder()
        .setName('xp')
        .setDescription('ニックネームのレベルバッジ表示を切り替えます。')
        .addSubcommand(sub => sub.setName('hide').setDescription('バッジを非表示にする'))
        .addSubcommand(sub => sub.setName('show').setDescription('バッジを表示に戻す')),

    // 13. XP・レベル確認（全員）
    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('自分または指定ユーザーの経験値・レベルを表示します。')
        .addUserOption(opt =>
            opt.setName('user').setDescription('確認するユーザー（省略時は自分）')
        ),

    // 13. XPランキング（全員）
    new SlashCommandBuilder()
        .setName('top')
        .setDescription('XPランキング TOP10 を表示します。')
        .addStringOption(opt =>
            opt.setName('period')
                .setDescription('集計期間（デフォルト: トータル）')
                .addChoices(
                    { name: 'トータル', value: 'total' },
                    { name: '本日',     value: 'day'   },
                    { name: '今週',     value: 'week'  },
                    { name: '今月',     value: 'month' },
                )
        ),

    // 14. XP管理（管理者のみ）
    new SlashCommandBuilder()
        .setName('xpadmin')
        .setDescription('XP・レベルを管理します（管理者のみ）。')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('ユーザーのレベルを直接設定します。')
                .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true))
                .addIntegerOption(opt => opt.setName('level').setDescription('設定するレベル').setRequired(true).setMinValue(0).setMaxValue(999))
        )
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('ユーザーのXPを加算・減算します。')
                .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true))
                .addIntegerOption(opt => opt.setName('amount').setDescription('XP量（マイナスで減算）').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('ユーザーのXP・レベルをリセットします。')
                .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('exclude')
                .setDescription('XP対象外ロールを管理します。')
                .addStringOption(opt =>
                    opt.setName('action').setDescription('操作').setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add' },
                            { name: '解除', value: 'remove' },
                            { name: '一覧', value: 'list' },
                        )
                )
                .addRoleOption(opt => opt.setName('role').setDescription('対象ロール（add/remove時は必須）'))
        )
        .addSubcommand(sub =>
            sub.setName('syncnicks')
                .setDescription('全ユーザーのニックネームにレベルバッジを一括反映します。')
        )
        .addSubcommand(sub =>
            sub.setName('alias')
                .setDescription('ニックネームに使う通称を設定します（長い名前の短縮用）。')
                .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true))
                .addStringOption(opt => opt.setName('name').setDescription('通称（省略するとリセット）').setMaxLength(20))
        ),

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🧹 古いグローバルコマンドを掃除中...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        console.log('🚀 最新のコマンドを登録中...');
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            console.log('✅ サーバー限定で登録完了');
        } else {
            await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
            console.log('✅ グローバルで登録完了');
        }
        console.log('💡 Discordを Ctrl+R で再起動して確認してください。');
    } catch (error) {
        console.error('❌ 登録中にエラーが発生しました:', error);
    }
})();