# Vesta

Windows 用のタブ型ファイラ。開いたタブを横に並べて表示し、Explorer と同じ右クリックメニュー・ごみ箱・元に戻すが使える。

タブ型ファイラ Avesta（作者：LaLa Moo-Moo 氏。現在は [Avestan](https://github.com/takechi/Avestan) として保守されている）を手本に、Tauri（Rust と Web 技術）で一から作り直したもの。Avesta のプログラム・画像・設定ファイルは含んでいない。

## インストール

[Releases](https://github.com/khlizard/vesta/releases) の `Vesta-win-Setup.exe` を実行する（Windows 10 / 11、x64。管理者権限は要らない）。インストールせずに使うなら、`Vesta-win-Portable.zip` を展開して `Vesta.exe` を実行する。

- 画面の文字は日本語だけ
- WebView2 ランタイムを使う。Setup は、無ければ一緒に入れる。Portable 版では先に入れておく（Windows 11 には初めから入っている）
- 新しい版は自動でダウンロードされる。ステータスバーの「Vesta {版} に更新」を押すか、終了したときに更新する。このために起動時と 6 時間ごとに GitHub へ接続する（止める設定は無い。ほかの通信はしない）。Portable 版も同じ
- コード署名をしていないので、初めて開くときに SmartScreen の警告が出ることがある
- アンインストールは「設定 → アプリ → インストールされているアプリ」から。設定（`%APPDATA%\io.github.khlizard.vesta\`）と表示用のデータ（`%LocalAppData%\io.github.khlizard.vesta\`）は残るので、要らなければ手で消す

## 使い方

- 起動すると、前回のタブを復元する。初回はドキュメントフォルダを開く
- タブのクリックでそのタブだけを表示し、Ctrl+クリックで表示するタブを加える。表示中のタブは横に並ぶ
- 表示モードは「詳細」と「縮小版」。詳細の列は、見出しの右クリックで選び、ドラッグで並べ替える
- リンクバーのメニューで Ctrl を押しながら項目を選ぶと、横にペインを足して開く
- 場所の入力では、`~` をユーザーフォルダとして読む（`~\Downloads` など）
- `vesta.exe <フォルダ>` で、そのフォルダを開く。既に起動していれば、そのウィンドウで開く

### 既定の操作

Explorer と違うものを中心に挙げる。キーは `usr\keyboard-*.xml` で変えられる。

| 操作 | 動作 |
|---|---|
| タブをクリック / Ctrl+クリック | そのタブだけを表示 / 表示するタブに加える（外す） |
| タブをダブルクリック / 中クリック | ロック（移動のたびに新しいタブを開く） / 閉じる |
| 一覧の空いた所をダブルクリック、Backspace | 上のフォルダへ |
| Tab / Shift+Tab | 右隣 / 左隣のペインへ |
| Ctrl+T / Ctrl+W / Ctrl+Shift+T | PC を新しいタブで開く / タブを閉じる / 閉じたフォルダを開き直す |
| Ctrl+H / Ctrl+数字 / Alt+数字 | タブを隠す / その番号のタブを表示・隠す / その番号のタブへ |
| F7 / F8 | 選択項目を隣のペインへコピー / 移動 |
| F2（名前の変更中） | 拡張子と名前の部分を交互に選ぶ |
| Ctrl+N / Ctrl+Shift+N | 名前を入力して新規作成 / 新しいフォルダー |
| Ctrl+F | パターン（`*.txt` など）で選択 |
| Ctrl+E | コマンドプロンプト、メモ帳のメニュー |

## 設定

設定ファイルは `%APPDATA%\io.github.khlizard.vesta\` にある。

- `usr\`：メニュー、ツールバー、ステータスバー、リンクバー、キー割り当て（`menu.xml`、`tool.xml`、`status.xml`、`link.xml`、`keyboard-form.xml`、`keyboard-folder.xml`）。初回の起動時に既定のものが作られる。書き換えたら「ツール → 設定ファイルを読み直す」で反映する
- `var\`：タブとウィンドウの位置（`session.json`）、オプション（`config.json`）、フォルダごとの表示（`folders.json`）、問題の記録（`crash.log`、`vesta.log`）
- 書式は [docs/spec/config.md](docs/spec/config.md)、使えるコマンドは [docs/spec/commands.md](docs/spec/commands.md)
- 書式は Avesta の `usr\` と同じなので、Avesta の同じ名前のファイルで置き換えても使える（Shift_JIS と UTF-8 のどちらも読める。Vesta にないコマンドの項目は出ない）。場所を書くとき、`VESTA`（と `AVESTA`）はこの設定フォルダを指す

## 既知の制限

- **無い機能**：ファイルの検索、フォルダのツリー、プレビュー、ダークテーマ
- **元に戻す（Ctrl+Z）**：Vesta の中で行った操作だけ（50 件まで。終了すると消える）。同じ名前を上書き・統合したコピーや移動、完全な削除、右クリックメニューやほかのソフトが行った操作は戻せない（[docs/spec/fileops.md](docs/spec/fileops.md)）
- **応答しないサーバー**（電源の切れた NAS など）のフォルダは、Windows があきらめるまで読み込みが終わらず、ほかの操作も待たされることがある
- **自動で更新されない場所**：PC、ごみ箱、`\\サーバー名`（共有の一覧）。F5 で読み直す
- **260 文字を超えるパス**：表示・コピー・名前の変更はできるが、削除や新規作成は失敗することがある
- **オンラインのみのファイル**（Dropbox、OneDrive など）：表示ではダウンロードされず、開く・コピーするとダウンロードされる（確かめたのは Dropbox だけ）
- **同じドライブかどうか**はドライブ文字で決める（ドラッグが移動になるかコピーになるかに関わる）。`subst` などの別名は考えない
- UTF-16 として正しくない名前のファイル（ごくまれ）は、正しく扱えない

## 開発

必要なもの：Rust（版は `src-tauri/rust-toolchain.toml` に固定。rustup が自動で入れる）、Visual Studio Build Tools（C++）、Node.js と npm。

```
npm install
npm run tauri dev
```

仕様は [docs/spec/](docs/spec/)、検証とリリースの手順は [docs/development.md](docs/development.md) にある。

## ライセンス

[MIT ライセンス](LICENSE)。

- アイコン：[Lucide](https://lucide.dev)（ISC ライセンス）
- 自動更新：[Velopack](https://velopack.io)（MIT ライセンス）
- そのほかの依存ライブラリと、そのライセンスの一覧：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)（配布物にも `LICENSE` と一緒に入っている）
