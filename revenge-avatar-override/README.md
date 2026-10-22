# Avatar Override (Revenge plugin)

指定したユーザーIDのアバターを、**自分の端末上の表示だけ**好きな画像に差し替えるRevengeプラグインです。
差し替えはローカル表示のみで、相手や他の閲覧者・サーバーには一切送信・共有されません。Discord本来のアバターは変わりません。

## 使い方

1. Revengeの `設定 > プラグイン` を開き、右上からリポジトリURLを追加します。
   `https://<あなたのGitHubユーザー名>.github.io/<このリポジトリ名>/avatar-override`
   (GitHub Pagesでホストする場合。手元でビルドしたものを直接読み込む場合は下記「ビルド」を参照)
2. 一覧に出てくる `Avatar Override` をインストールして有効化します。
3. プラグインの設定画面を開き、「ユーザーを追加」からユーザーID → 差し替えたい画像のURLを入力します。
4. 一覧の項目をタップでURL編集、長押しで削除できます。

ユーザーIDは対象ユーザーのプロフィールから「IDをコピー」(開発者モードが必要) で取得してください。

## 仕組み

`getUserAvatarURL` / `getUserAvatarSource` (アバター描画に使われる内部モジュール) と `UserStore.getUser` にパッチを当て、
登録済みのユーザーIDに一致した場合だけローカルに保存した画像URLを返すようにしています。GIFのURLを登録すると、
プロフィールなどアニメーション表示に対応した箇所ではアニメーションGIFとして、それ以外では静止画として表示されます。

保存データはプラグインのストレージ (`@vendetta/plugin` の `storage`) に `{ userId: 画像URL }` の形で保持されます。

## ビルド方法

```sh
cd revenge-avatar-override
npm install
npm run build
```

`dist/avatar-override/` にビルド済みの `manifest.json` と `index.js` が出力されます。
このディレクトリをそのまま静的ホスティング (GitHub Pagesなど) に置き、そのURルをRevengeのプラグインリポジトリとして追加してください。
リポジトリの `main` ブランチへの push で `.github/workflows/deploy.yml` が自動的にビルド・GitHub Pagesへのデプロイを行います
(リポジトリの設定でGitHub Pagesのソースを `gh-pages` ブランチに設定してください)。

## 注意事項

- Discordのアプリ内部実装の変更で、パッチが効かなくなる可能性があります。
- モバイル版Discord (Revenge) 専用です。デスクトップ版Discordのmod (Vencordなど) では動作しません。
- 画像URLはリンク先のホストが生きている必要があります (画像を差し替えたら反映されます)。
