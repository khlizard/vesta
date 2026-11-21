# 開発

準備と起動は README の「開発」を参照。

## 同期フォルダに置くとき

このリポジトリを Dropbox などの同期フォルダに置く場合は、Rust のビルド出力を同期の外に出す。
`src-tauri/.cargo/config.toml`（git 管理外）に次のように書く。この設定は `src-tauri` の中で実行した cargo だけが読む。

```toml
[build]
target-dir = "C:/Users/<ユーザー名>/.cargo-target/vesta"
```

## 検証

```
npm run format:check   # 整形の確認（直すのは npm run format）
npm run typecheck
npm run lint
npm test
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

## リリース

1. `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json` のバージョンをそろえて上げる
2. `CHANGELOG.md` に、その版の節（`## 0.1.1` など）と変更点を書く。これが Releases の説明と更新の説明になる
3. コミットして `v{版}` のタグを push する。GitHub Actions がビルドして Releases に公開する

手元から出すときは `scripts/release.ps1`（[Velopack](https://velopack.io) の `vpk` が要る：`dotnet tool install -g vpk --version 1.2.161`）。

```
$env:GITHUB_TOKEN = "<contents に書き込めるトークン>"
./scripts/release.ps1             # ビルド → パッケージ → Releases に公開
./scripts/release.ps1 -NoUpload   # build/velopack/releases に作るだけ
```

exe は `scripts/build-exe.ps1` でビルドする。Rust は依存ライブラリの場所（`C:\Users\<ユーザー名>\.cargo\...`）を exe に埋め込むので、このスクリプトがそれを固定の文字に置き換え、ユーザー名が残っていればビルドを失敗させる。配布する exe を `npm run tauri build` で直接作らない。
