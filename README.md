# Vesta

Windows 用のタブ型ファイラ。開いたタブを横に並べて表示し、Explorer と同じ右クリックメニューやごみ箱、元に戻すが使える。

タブ型ファイラ Avesta（作者：LaLa Moo-Moo 氏。現在は [Avestan](https://github.com/takechi/Avestan) として保守されている）を参考に、自分が使いやすい形でリメイクしたもの。Avesta の操作感や設定ファイルの書式を手本にしつつ、プログラムは Tauri（Rust と Web 技術）で一から作り直している。Avesta のプログラム・画像・設定ファイルは含んでいない。

## インストール

[Releases](https://github.com/khlizard/vesta/releases) の `Vesta-win-Setup.exe` を実行する（Windows 10 / 11、x64）。インストールせずに使うなら `Vesta-win-Portable.zip` を展開して `Vesta.exe` を実行する。

- ユーザーごとに `%LocalAppData%\Vesta\` へ入る。管理者権限は要らない
- 新しい版が出ると裏でダウンロードし、ステータスバーに「Vesta {版} に更新」が出る。押すとすぐ再起動して更新し、押さなくても終了したときに更新する
- コード署名をしていないので、初めて開くときに Windows の SmartScreen の警告が出ることがある

## 使い方

- 起動すると、前回のタブを復元する。初回はドキュメントフォルダを開く
- タブのクリックでそのタブだけを表示し、Ctrl+クリックで表示するタブを追加する。表示中のタブは横に並ぶ
- リンクバーのメニューで Ctrl を押しながら項目を選ぶ（クリック、Enter、アクセスキー）と、今の表示はそのままで、横にペインを追加して開く
- リンクバーの項目のうち、場所が見つからないもの（消したフォルダ、つないでいないドライブ）は、灰色の文字と × で表示する
- Dropbox や OneDrive などの同期フォルダの中では、アドレスバーのアイコンがそのサービスのアイコンになる
- 表示モードは「詳細」と「縮小版」の2つ。詳細の列は見出しの右クリックで選び、ドラッグで並べ替える
- 文字の大きさは「表示 → 文字の大きさ」で変える
- `vesta.exe <フォルダ>` で、そのフォルダを開く。既に起動していれば、そのウィンドウで開く
- キー操作の既定は `%APPDATA%\io.github.khlizard.vesta\usr\keyboard-*.xml` を参照（Ctrl+W でタブを閉じる、Ctrl+N で新規作成 など）

## 設定

設定ファイルは `%APPDATA%\io.github.khlizard.vesta\` にある。

| フォルダ | 中身 |
|---|---|
| `usr\` | `menu.xml`、`tool.xml`、`status.xml`、`link.xml`、`keyboard-form.xml`、`keyboard-folder.xml` |
| `var\` | タブとウィンドウの位置（`session.json`）、オプション（`config.json`）、フォルダごとの表示設定（`folders.json`）、異常終了の記録（`crash.log`） |

- `usr\` のファイルは、初回の起動時に Vesta の既定のものが作られる。書き換えたら、メニューの「ツール → 設定ファイルを読み直す」で反映する
- メニュー、ツールバー、ステータスバー、リンクバー、キー割り当てを書き換えられる。書式は [docs/spec/config.md](docs/spec/config.md)、使えるコマンドは [docs/spec/commands.md](docs/spec/commands.md)
- 書式は Avesta の usr\ と同じなので、Avesta を使っていた人は、手元の Avesta の同じ名前のファイルで置き換えて使うこともできる（Shift_JIS と UTF-8 のどちらでも読める）。Vesta にないコマンドの項目は表示されない
- 場所を書くとき、`VESTA`（と `AVESTA`）はこのアプリの設定フォルダを指す

## 既知の制限

- **元に戻す（Ctrl+Z）の範囲**：Vesta の中で行った、名前の変更・移動・コピー・複製・新規作成・ショートカットの作成・ごみ箱へ送る、を戻せる（50 件まで。終了すると消える）。次のものは戻せない
  - 同じ名前の項目を上書きした・フォルダを統合したコピーや移動（上書きされた元のファイルは残らない。Explorer と同じ）
  - 完全に削除したもの、ごみ箱に入らないもの（ネットワーク上のファイル、大きすぎるファイル。削除の前に Windows の確認が出る）
  - 右ボタンのドラッグのメニュー、右クリックメニューの「送る」や圧縮ソフトなど、Windows やほかのソフトが行う操作
- **ネットワーク**：応答しないサーバー（電源の切れた NAS など）のフォルダを開くと、Windows があきらめるまで読み込みが終わらない。いくつも重なると、ほかのペインの読み込みやファイルを開く操作も待たされる。切断された共有フォルダの項目の上で右クリックやドラッグをすると、しばらく固まることがある
- **自動で更新されない場所**：PC、ごみ箱、`\サーバー名`（共有の一覧）は、F5 で読み直す
- **同じドライブかどうか**は、ドライブ文字（共有フォルダは `\サーバー共有名`）だけで決める。`subst` やフォルダに割り当てた別のドライブは考えない（修飾キーなしのドラッグが、移動になるかコピーになるかに関わる）
- **260 文字を超えるパス**：フォルダの表示・コピー・名前の変更はできるが、削除や新規作成は失敗することがある。失敗したときは理由がステータスバーに出る
- **オンラインのみのファイル**（Dropbox、OneDrive など）：一覧・アイコン・縮小版の表示ではダウンロードされない。開く・コピーするとダウンロードされる。確認したのは Dropbox だけ
- **名前の並び順**：数字は大きさの順（「第2章」は「第10章」の前。全角の数字も同じ）。記号の順は Explorer と少し違う
- UTF-16 として正しくない名前のファイル（ごくまれ）は、正しく扱えない

## 開発

必要なもの：Rust（stable、`x86_64-pc-windows-msvc`）と Visual Studio Build Tools（C++）、Node.js と npm。

```
npm install
npm run tauri dev      # 開発用に起動
```

このリポジトリを Dropbox などの同期フォルダに置く場合は、Rust のビルド出力を同期の外に出す。
`src-tauri/.cargo/config.toml`（git 管理外）に次のように書く。この設定は `src-tauri` の中で実行した cargo だけが読む。

```toml
[build]
target-dir = "C:/Users/<ユーザー名>/.cargo-target/vesta"
```

仕様は `docs/spec/` にある。

### 検証

```
npm run typecheck
npm run lint
npm test
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

### リリース

1. `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json` のバージョンをそろえて上げる
2. `CHANGELOG.md` に、その版の節（`## 0.1.1` など）と変更点を書く。これが Releases の説明と更新の説明になる
3. コミットして `v{版}` のタグを push する。GitHub Actions がビルドして Releases に公開する

手元から出すときは `scripts/release.ps1`（[Velopack](https://velopack.io) の `vpk` が要る：`dotnet tool install -g vpk --version 1.2.161`）。

```
$env:GITHUB_TOKEN = "<contents に書き込めるトークン>"
./scripts/release.ps1             # ビルド → パッケージ → Releases に公開
./scripts/release.ps1 -NoUpload   # build/velopack/releases に作るだけ
```

## ライセンス

[MIT ライセンス](LICENSE)。

- アイコン：[Lucide](https://lucide.dev)（ISC ライセンス）
- 自動更新：[Velopack](https://velopack.io)（MIT ライセンス）
- そのほかの依存ライブラリと、そのライセンスの一覧：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
