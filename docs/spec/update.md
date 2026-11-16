# インストールと自動更新

Velopack で配布し、GitHub Releases（https://github.com/khlizard/vesta ）から自動で更新する。

## インストール

- `Vesta-win-Setup.exe`（Velopack の Setup、x64）で入れる。インストールしない `Vesta-win-Portable.zip` も出す（こちらも同じように更新する）。ユーザーごとに `%LocalAppData%\Vesta\` へ入り、管理者権限は要らない
- WebView2 ランタイムが無い PC では、Setup が一緒に入れる
- デスクトップとスタートメニューにショートカットを作る
- 設定と状態（`%APPDATA%\io.github.khlizard.vesta\` の usr/ と var/）はインストール先と別なので、更新・再インストールで消えない
- パッケージ ID は `Vesta`。アプリの識別子（`io.github.khlizard.vesta`）と分ける（`%LocalAppData%\io.github.khlizard.vesta\` は WebView2 のデータ置き場で、アンインストールで消されないようにするため）

## 更新の流れ

1. 起動して少し後（5 秒）と、その後 6 時間ごとに、GitHub Releases に新しい版があるか調べる
2. あれば裏でダウンロードする（前の版との差分があれば差分だけ）
3. ダウンロードが済んだら、ステータスバーの左端に「Vesta {版} に更新」のボタンを出す
   - 押す（`System.Update`）：タブと設定を保存してから、更新して再起動する
   - 押さない：アプリを終了したときに更新する（次に起動したときは新しい版になっている）
4. 調べるのに失敗しても（オフラインなど）何も表示しない。次の機会に調べ直す

- Velopack で入れていないとき（`npm run tauri dev` など）は、更新を調べない
- `System.Update` は Vesta だけのコマンド。更新が無いときは押せない

## リリース

- バージョンは `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json` の3か所をそろえて上げる（SemVer）
- `CHANGELOG.md` に `## {版}` の節を書き、変更点を箇条書きにする。リリースはこの節を、パッケージの説明（Velopack の release notes）と GitHub の Release の本文に使う。節が無い・空ならリリースを止める
- `v{版}` のタグを push すると、GitHub Actions（`.github/workflows/release.yml`）がビルドして Releases に公開する
- 手元でも `scripts/release.ps1` で同じことができる（`GITHUB_TOKEN` に contents の書き込み権限のあるトークン）。`-NoUpload` で、公開せずに `build/velopack/releases/` に作るだけにする

## 手元の確認用の上書き

- `scripts/install-local.ps1`：リリース版をビルドし、インストール済みの `%LocalAppData%\Vesta\current\vesta.exe` を上書きする。Velopack のパッケージは作らず、バージョンも変えない
- インストール先から起動している Vesta があれば、ウィンドウを閉じて（タブと設定は保存される）終わるのを待ってから上書きする。10 秒で終わらなければ強制終了する。開発用の `tauri dev` のものは止めない
- Velopack でインストールしていない（`current\vesta.exe` が無い）ときは止める
