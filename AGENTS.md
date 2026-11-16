# Vesta（avesta-tauri-tabbed-filer）

## やりたいこと

タブ型ファイラ "Avesta" を参考に、Tauri で作り直す。アプリの名前は Vesta（識別子 `io.github.khlizard.vesta`）

## 方針

- Avesta（C++/WTL）のコードは移植しない。挙動を仕様として取り出し、Rust と Web UI で作り直す
- シンプルな複数タブ型のファイラにする。使われない機能は足さない。そのかわり、設定ファイル（usr/*.xml）で変えられる範囲は広く保つ
- 仕様は `docs/spec/` が正。実装する前に該当する仕様を読み、仕様を変えたら先に `docs/spec/` を直す
- Avesta の挙動を確かめるときは `reference/Avestan/` を読む（git 管理外。なければ `git clone https://github.com/takechi/Avestan reference/Avestan`）
- Windows 専用。表示モードは詳細と縮小版、ペインは横並びだけ
- 設定ファイルは Avesta と同じ XML 書式（`docs/spec/config.md`）
- コマンド名は Avesta と同じ（`Current.Go.Up` など）。メニュー、ツールバー、キー操作はすべて `src/commands/` のコマンドを通す

## 構成

| パス | 中身 |
|---|---|
| `src/` | フロントエンド（React + TypeScript + Vite、zustand） |
| `src-tauri/src/` | バックエンド（Rust、`windows` crate で Shell API を呼ぶ） |
| `src-tauri/resources/usr/` | 既定の設定ファイル |
| `docs/spec/` | 仕様（コマンドの一覧は `docs/spec/commands.md`） |
| `docs/poc.md` | 技術検証の結果 |
| `docs/checklist.md` | 手動で確認する項目 |

## コマンド

| 目的 | コマンド |
|---|---|
| 開発用に起動 | `npm run tauri dev` |
| 配布物を作る（Velopack、公開しない） | `./scripts/release.ps1 -NoUpload` |
| インストール済みの Vesta を上書き（手元で確認） | `./scripts/install-local.ps1` |
| リリース | `v{版}` タグを push（`.github/workflows/release.yml`）。手元からは `./scripts/release.ps1` |
| 型チェック | `npm run typecheck` |
| lint | `npm run lint` |
| フロントのテスト | `npm test` |
| Rust のテスト | `src-tauri` の中で `cargo test` |
| Rust の lint | `src-tauri` の中で `cargo clippy --all-targets -- -D warnings` |

- cargo は `src-tauri` の中で実行する。`src-tauri/.cargo/config.toml`（ビルド出力の場所を変える設定。git 管理外）は、そこで実行したときだけ読まれる
- インストール済みの Vesta で確かめたいときは `./scripts/install-local.ps1`（リリース版をビルドして、インストール先の exe を上書きする）
- `npm run tauri dev` で起動したままソースを書き換えると、ホットリロードで状態が食い違うことがある。おかしいときは起動し直す

## 書き方

- Rust の Win32/COM 呼び出しは、モジュールの中に閉じ込める。Tauri のコマンドは薄くし、ロジックはテストできる関数に分ける
- 判断のロジック（タブの操作、開き方の表、ラベル、ステータスの文字、キーマップ）は、UI から切り離した純粋な関数にして vitest でテストする
- COM はスレッドの種類に注意する。右クリックメニューはメインスレッド、ファイル操作は専用の STA スレッドで呼ぶ
