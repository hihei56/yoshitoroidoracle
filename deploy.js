require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
    // 1. ダイス勝負
    new SlashCommandBuilder()
        .setName('dice')
        .setDescription('1日1回のダイス勝負。当たると制限がかかる場合があります。'),

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
                .setName('chatter_channel')
                .setDescription('賑やかしBot（chatter）の自動投稿チャンネルを設定します。未指定で解除。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('投稿先チャンネル（省略で解除）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('rss_channel')
                .setDescription('RSS自動投稿の送信先チャンネルを設定します。未指定で解除。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('投稿先チャンネル（省略で解除）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit_monitor_exclude')
                .setDescription('メッセージ編集アラート（edit-logging）の監視対象外にするユーザー/ロールを管理します。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('操作を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add'    },
                            { name: '解除', value: 'remove' },
                            { name: '一覧', value: 'list'   },
                        )
                )
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象のユーザー（ロールと併用可、add/remove時に指定）')
                )
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('対象のロール（ユーザーと併用可、add/remove時に指定）')
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('vc_recruit')
                .setDescription('VC募集機能の設定・試し打ちを行います。')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('channel')
                        .setDescription('VC募集メッセージの自動投稿チャンネルを設定します。未指定で解除（賑やかしBotと共通）。')
                        .addChannelOption(option =>
                            option.setName('channel')
                                .setDescription('投稿先チャンネル（省略で解除）')
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('role')
                        .setDescription('VC募集ボタンを押したときにメンションするロールを設定します。未指定で解除（デフォルトロール）。')
                        .addRoleOption(option =>
                            option.setName('role')
                                .setDescription('メンション対象ロール（省略で解除）')
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('test')
                        .setDescription('VC募集メッセージをこのチャンネルに試し打ちします。')
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
                .setName('timeout_remove')
                .setDescription('サーバー上の全員のタイムアウトを解除します（管理者のみ）。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('chatter')
                .setDescription('賑やかしchatterをこのチャンネルに試し打ちします。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remind')
                .setDescription('Bumpリマインダーの通知をDMでも受け取るユーザーを管理します。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('操作を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add'    },
                            { name: '解除', value: 'remove' },
                            { name: '一覧', value: 'list'   },
                        )
                )
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象ユーザー（add/remove時は必須）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('ranking_channel')
                .setDescription('週間/月間XPランキングを自動発表するチャンネルを設定します。未指定で解除。')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('発表先チャンネル（省略で解除）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('shiritori_channel')
                .setDescription('しりとりゲームを行うチャンネルを設定します。未指定で解除（ゲームもリセット）。')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('ゲームを行うチャンネル（省略で解除）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('rta_channel')
                .setDescription('1day-RTA（日付変更後の最速投稿を表彰）を行うチャンネルを設定します。未指定で解除。')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('対象のメインチャット（省略で解除）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('ng_word')
                .setDescription('検閲対象の臨時NGワードを追加/削除/一覧表示します。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('操作を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add'    },
                            { name: '削除', value: 'remove' },
                            { name: '一覧', value: 'list'   },
                        )
                )
                .addStringOption(option =>
                    option.setName('word')
                        .setDescription('対象の単語（add/remove時は必須）')
                )
                .addIntegerOption(option =>
                    option.setName('duration_minutes')
                        .setDescription('何分間有効にするか（省略で無期限。add時のみ使用）')
                        .setMinValue(1)
                        .setMaxValue(10080)
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
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('voice_ban')
                .setDescription('一時ボイスチャンネル機能の利用（作成・参加）を禁止するユーザー/ロールを管理します。')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('操作を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add'    },
                            { name: '解除', value: 'remove' },
                            { name: '一覧', value: 'list'   },
                        )
                )
                .addUserOption(opt => opt.setName('user').setDescription('対象のユーザー（ロールと併用可）'))
                .addRoleOption(opt => opt.setName('role').setDescription('対象のロール（ユーザーと併用可）'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('spam_strikes')
                .setDescription('頻発スパム取り締まりの違反カウントを確認/リセットします。')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('操作を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '確認',   value: 'get'   },
                            { name: 'リセット', value: 'reset' },
                        )
                )
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('対象のユーザー')
                        .setRequired(true)
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
            sub.setName('setmonth')
                .setDescription('月間ランキングを翌月モード/通常モードでトグルします。')
        )
        .addSubcommand(sub =>
            sub.setName('alias')
                .setDescription('ニックネームに使う通称を設定します（長い名前の短縮用）。')
                .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true))
                .addStringOption(opt => opt.setName('name').setDescription('通称（省略するとリセット）').setMaxLength(20))
        )
        .addSubcommand(sub =>
            sub.setName('hidebadge')
                .setDescription('ユーザーまたはロール単位でバッジ表示を強制オン/オフします。')
                .addBooleanOption(opt => opt.setName('hide').setDescription('true=非表示 / false=表示').setRequired(true))
                .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー（userかroleどちらか必須）'))
                .addRoleOption(opt => opt.setName('role').setDescription('対象ロール（そのロールの全メンバーに適用）'))
        )
        .addSubcommand(sub =>
            sub.setName('levelnotif')
                .setDescription('レベルアップ通知のON/OFFを切り替えます。')
                .addBooleanOption(opt => opt.setName('enable').setDescription('true=ON / false=OFF').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('transfer')
                .setDescription('BANされたユーザーのXP・レベルを別ユーザーに引き継ぎます。')
                .addStringOption(opt => opt.setName('from_id').setDescription('引き継ぎ元のユーザーID（BAN済み）').setRequired(true))
                .addUserOption(opt => opt.setName('to').setDescription('引き継ぎ先のユーザー').setRequired(true))
        ),

    // 16. Disboard Bump リマインダー
    new SlashCommandBuilder()
        .setName('bump-setup')
        .setDescription('Disboard /bump のリマインダー通知チャンネルを設定します（サーバー管理権限が必要）。')
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('通知を送信するテキストチャンネル')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('remind_minutes')
                .setDescription('Bump可能になる何分前に通知するか（デフォルト: 10分）')
                .setMinValue(1)
                .setMaxValue(120)
        ),

    new SlashCommandBuilder()
        .setName('bump-status')
        .setDescription('現在のBumpクールダウン状況を表示します。'),

    new SlashCommandBuilder()
        .setName('bump-force-notify')
        .setDescription('Bump通知チャンネルに強制的に通知を送信します（サーバー管理権限が必要）。'),

    new SlashCommandBuilder()
        .setName('bump-history')
        .setDescription('直近のBump実行履歴を表示します。')
        .addIntegerOption(opt =>
            opt.setName('count')
                .setDescription('表示件数（デフォルト: 5件）')
                .setMinValue(1)
                .setMaxValue(20)
        ),

    // 15. 一時ボイスチャンネル パネル（管理者のみ）
    new SlashCommandBuilder()
        .setName('voicepanel')
        .setDescription('一時ボイスチャンネル機能を設定します（管理者のみ）。')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('参加用チャンネルと作成先カテゴリを設定します。')
                .addChannelOption(opt =>
                    opt.setName('join_channel')
                        .setDescription('参加すると一時チャンネルが作成されるボイスチャンネル')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('category')
                        .setDescription('作成先カテゴリ（省略時は参加用チャンネルと同じカテゴリ）')
                        .addChannelTypes(ChannelType.GuildCategory)
                )
        )
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('一時ボイスチャンネルのチャット内で、消えたパネルを再送信します。')
        )
        .addSubcommand(sub =>
            sub.setName('notify')
                .setDescription('一時ボイスチャンネルの通話継続通知を設定します。')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('通知を送信するテキストチャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('通知時にメンションするロール（省略でメンションなし）')
                )
                .addIntegerOption(opt =>
                    opt.setName('minutes')
                        .setDescription('通話継続何分で通知するか（デフォルト: 5分）')
                        .setMinValue(1)
                        .setMaxValue(180)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('現在の設定を確認します。')
        )
        .addSubcommandGroup(group =>
            group.setName('roomconfig')
                .setDescription('特定ユーザーの一時ボイスチャンネルの永続設定を管理します。')
                .addSubcommand(sub =>
                    sub.setName('ban')
                        .setDescription('指定ユーザーの部屋にユーザー/ロールを出禁にします（部屋を作り直しても引き継がれます）。')
                        .addUserOption(opt => opt.setName('owner').setDescription('部屋の持ち主').setRequired(true))
                        .addUserOption(opt => opt.setName('user').setDescription('出禁にするユーザー'))
                        .addRoleOption(opt => opt.setName('role').setDescription('出禁にするロール'))
                )
                .addSubcommand(sub =>
                    sub.setName('unban')
                        .setDescription('指定ユーザーの部屋の出禁を解除します。')
                        .addUserOption(opt => opt.setName('owner').setDescription('部屋の持ち主').setRequired(true))
                        .addUserOption(opt => opt.setName('user').setDescription('出禁解除するユーザー'))
                        .addRoleOption(opt => opt.setName('role').setDescription('出禁解除するロール'))
                )
                .addSubcommand(sub =>
                    sub.setName('defaults')
                        .setDescription('指定ユーザーの部屋のデフォルト設定（人数制限・ロック・NSFW）を変更します。')
                        .addUserOption(opt => opt.setName('owner').setDescription('部屋の持ち主').setRequired(true))
                        .addIntegerOption(opt => opt.setName('limit').setDescription('デフォルト人数制限（0で無制限）').setMinValue(0).setMaxValue(99))
                        .addBooleanOption(opt => opt.setName('locked').setDescription('部屋を作成時に自動でロックするか'))
                        .addBooleanOption(opt => opt.setName('nsfw').setDescription('NSFW設定にするか'))
                )
                .addSubcommand(sub =>
                    sub.setName('show')
                        .setDescription('指定ユーザーの部屋の永続設定を表示します。')
                        .addUserOption(opt => opt.setName('owner').setDescription('部屋の持ち主').setRequired(true))
                )
        ),

    // 17. 条件付き一括削除
    new SlashCommandBuilder()
        .setName('clean')
        .setDescription('条件を指定してメッセージを一括削除します（メッセージの管理権限が必要）。')
        .addIntegerOption(opt =>
            opt.setName('count')
                .setDescription('走査するメッセージ数（デフォルト: 100、最大1000）')
                .setMinValue(1)
                .setMaxValue(1000)
        )
        .addUserOption(opt => opt.setName('user').setDescription('このユーザーの発言のみ削除'))
        .addBooleanOption(opt => opt.setName('bots').setDescription('Botの発言を削除'))
        .addBooleanOption(opt => opt.setName('embeds').setDescription('Embed付きの発言を削除'))
        .addBooleanOption(opt => opt.setName('links').setDescription('URLを含む発言を削除'))
        .addBooleanOption(opt => opt.setName('images').setDescription('画像/動画付きの発言を削除'))
        .addStringOption(opt => opt.setName('contains').setDescription('指定した文字列を含む発言を削除'))
        .addStringOption(opt => opt.setName('regex').setDescription('正規表現にマッチする発言を削除（上級者向け）')),

    // 18. タイムアウト付与
    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('指定したユーザーにタイムアウトを付与します（メンバーをタイムアウトさせる権限が必要）。')
        .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true))
        .addIntegerOption(opt =>
            opt.setName('minutes')
                .setDescription('タイムアウト時間(分)（デフォルト: 10分）')
                .setMinValue(1)
                .setMaxValue(40320)
        )
        .addStringOption(opt => opt.setName('reason').setDescription('理由（省略可）')),

    // 19. 読み上げBot
    new SlashCommandBuilder()
        .setName('yomiage-join')
        .setDescription('あなたのいるボイスチャンネルに参加し、このチャンネルのメッセージを読み上げます。'),

    new SlashCommandBuilder()
        .setName('yomiage-leave')
        .setDescription('ボイスチャンネルから退出します。'),

    new SlashCommandBuilder()
        .setName('yomiage-voice')
        .setDescription('あなたの読み上げボイスを選択します。')
        .addStringOption(opt =>
            opt.setName('voice')
                .setDescription('声を選択')
                .setRequired(true)
                .addChoices(
                    { name: 'ひろゆき',     value: 'hiroyuki' },
                    { name: '岡田斗司夫',   value: 'toshio'   },
                )
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