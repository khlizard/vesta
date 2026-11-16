# 設定ファイル

## 置き場所

アプリの設定フォルダ（`%APPDATA%\io.github.khlizard.vesta\`）の下に置く。

| フォルダ | 中身 | 書く人 |
|---|---|---|
| `usr/` | link.xml、keyboard-form.xml、keyboard-folder.xml、menu.xml、tool.xml、status.xml | ユーザー。初回の起動時に既定のファイルをコピーする。既にあるファイルは上書きしない |
| `var/` | session.json（タブ、最近閉じたフォルダ、ウィンドウ）、config.json（オプション）、folders.json（フォルダごとの表示設定）、crash.log（異常終了の記録） | アプリ |

- `Option.Reload`（設定ファイルの再読み込み）で usr/ を読み直す
- session.json の `window` は `{ "x", "y", "width", "height", "maximized" }`（物理ピクセル。ui.md「ウィンドウ」）
- 「設定ファイルフォルダを開く」は usr/ をタブで開く

## XML の共通ルール

- 書式は Avesta と同じ。Avesta の usr/ のファイルをそのままコピーして使える
- 文字コードは中身から決める：BOM があればそれ（UTF-8 / UTF-16）、無ければ UTF-8 として正しく読めるなら UTF-8、読めなければ Shift_JIS。XML 宣言の `encoding` は見ない
- このアプリにないコマンドの項目は読み飛ばす（Avesta からコピーした設定をそのまま使えるように、起動時は画面に出さず、ログにだけ出す）。`Option.Reload` で読み直したときは、使えなかったコマンド名をステータスバーに出す（書き間違いに気づけるように）
- ファイルが XML として読めないときは、そのファイルだけ既定の設定を使い、ステータスバーに出す。usr/ のフォルダ自体が使えないときは、6 ファイルとも既定の設定で動く
- 使えるコマンドの一覧は [commands.md](commands.md)
- `text` の `_X` は、X をアクセスキーにする（下線を付ける）。`{*}` は無視する
- `<menu/>`（属性なし）は区切り線

## menu.xml / tool.xml / status.xml

```xml
<menu>
  <menu text="ファイル(_F)">
    <menu text="フォルダの作成(_F)" command="Current.NewFolder" image="27"/>
    <menu/>
  </menu>
</menu>
```

| 属性 | 意味 |
|---|---|
| text | 表示する文字 |
| command | コマンド。`;` で区切ると順に実行する |
| navigate | 場所（navigation.md の書き方）を開く |
| execute / args | プログラムを実行する（下記） |
| image | アイコンの番号（下の「image の番号」）。ツールバーは 24px、メニューとステータスバーは 16px で描く |

- 子を持つ menu：メニューバーではサブメニュー。ツールバーでは、command があればドロップダウン付きボタン、なければドロップダウンだけのボタン
- ツールバーとステータスバーのボタンは、コマンドのチェック状態を押し込みで表示する

## image の番号

番号の並びは Avesta と同じにする（Avesta の usr/*.xml をコピーしても、合ったアイコンが出るように）。絵は Vesta の SVG アイコン（[Lucide](https://lucide.dev)、ISC ライセンス）で、表は `src/config/icons.ts`。表に無い番号は、アイコンを出さない（メニューとステータスバーでは同じ幅の空き。ツールバーでは text を出し、text も無ければ「…」のアイコンを出す。押せるボタンが見えなくならないように）。Avesta の menu.png などの画像は使わない。

| 番号 | 意味 | 番号 | 意味 |
|---|---|---|---|
| 1 | 元に戻す | 25 | 閉じる |
| 2 | 閉じたフォルダ（MRU） | 27 | 新しいフォルダー |
| 3 | 切り取り | 28 | 隠す |
| 4 | コピー | 29 | ロック |
| 5 | 貼り付け | 30 | ごみ箱を空にする |
| 6 | 削除 | 32 | 縮小版 |
| 7 | 戻る | 36 | 詳細 |
| 8 | 進む | 40 | すべて閉じる |
| 9 | 上へ | 41 | 右側を閉じる |
| 10 | 移動 | 42 | 左側を閉じる |
| 11 | コピー先へ | 43 | 隠れているタブを閉じる |
| 13 | 開く | 44 | 表示中のタブを閉じる |
| 14 | 保存 | 45 | 同じフォルダのタブを閉じる |
| 15 | 新規作成 | 46 | ほかのタブを閉じる |
| 16 | 隠しファイルを表示 | 53 | すべて表示 |
| 17 | 最新の情報に更新 | | |
| 18 | 中止 | | |
| 19 | ホーム | | |
| 21 | お気に入り | | |
| 24 | ウィンドウ | | |
| 26 | 表示形式の変更（表示形式を選ぶドロップダウン） | | |

## 既定の設定ファイル

- 既定の usr/ の6ファイルは `src-tauri/resources/usr/` にあり、exe に埋め込む。Vesta 用に書いたもので、Vesta にあるコマンドだけを使う
- 初回の起動時に usr/ へ書き出す。既にあるファイルは上書きしない

## link.xml

```xml
<menu>
  <menu text="fav">
    <menu text="_downloads" path="%USERPROFILE%\Downloads" depth="0"/>
    <menu text="_Work" path="D:\Work" depth="1"/>
  </menu>
</menu>
```

| 属性 | 意味 |
|---|---|
| text | 表示する文字 |
| path | 場所。なければ、子を並べるだけのメニュー |
| depth | 0：ただのボタン（またはメニュー項目）。N：N 階層までサブフォルダをメニューとして展開する。省略：制限なし |
| include-files | true / yes / 0 以外の数値：展開するときにファイルも含める。既定は含めない |
| args | path がファイルのとき、実行に付ける引数（下の「execute と args」と同じ置き換え）。Vesta だけの属性 |

- 最上位の項目はリンクバーのボタンになる。子がある項目と、depth が 0 でないフォルダは、ドロップダウンになる
- 子と、フォルダの展開の両方があるときは、子を先に並べてから区切り線を入れ、フォルダの中身を並べる
- 展開した中身は、メニューを開いたときに読む
- ドロップダウンを開いている間にマウスを別のドロップダウンのボタンへ移すと、そのボタンのメニューに切り替わる（メニューバーと同じ）。ドロップダウンでないボタンの上では、開いているメニューはそのまま
- アイコンは path が指すもののアイコン
- path の場所が見つからない項目（消したフォルダ、つないでいないドライブなど）は、灰色の文字にして、アイコンの代わりに × を出す。ツールチップに「見つかりません: path」を出す。選べない（子の `<menu>` があれば、そのメニューは開ける）。メニューを開くたび、ボタンは押すたびに探し直すので、ドライブをつなぎ直せば元に戻る
- クリック：フォルダなら「外から開く」の表に従って開く。ファイルなら実行する
- args のある項目は、引数入りのショートカット（.lnk）を作らずに、ソフトを引数付きで起動できる。例：`<menu text="Editor" path="C:\Program Files\Editor\editor.exe" args='"%USERPROFILE%\memo.txt"'/>`。path がフォルダなら args は無視する。作業フォルダは current のフォルダ
- 右クリック：path の右クリックメニュー

## keyboard-form.xml / keyboard-folder.xml

```xml
<keyboard name="folder">
  <bind modifier="C" key="E" execute="C:\Program Files\Editor\editor.exe" args="[selected]"/>
  <bind modifier="CS" key="C">
    <menu text="_P : パスをコピー" command="Current.Copy.Path"/>
  </bind>
</keyboard>
```

- form：ウィンドウのどこにフォーカスがあっても効く。folder：一覧にフォーカスがあるときだけ効き、form より優先する
- `modifier`：C（Ctrl）、S（Shift）、A（Alt）、W（Win）の組み合わせ。空なら修飾なし
- `key`：英数字、`F1`〜`F24`、`backspace`、`tab`、`return`、`escape`、`space`、`delete`、`insert`、`home`、`end`、`pageup`、`pagedown`、`←` `↑` `→` `↓`（`left` `up` `right` `down`、`enter`、`esc`、`del`、`bs`、`pgup`、`pgdn` の別名も可）、`,` `.` `/` `@` など記号（そのキーで Shift なしに入力される文字。キーボードの配列に合わせる）
- 子の `<menu>` があるときは、キーを押すとその場にポップアップメニューを出す
- 一覧が持っているキー（矢印、PageUp / PageDown、Home / End、Enter、Space、文字での頭出し）に割り当てを書くと、割り当てだけが動く
- メニューバーのアクセスキー（Alt+文字）は、同じキーの割り当てより優先する
- 再読み込み・印刷・検索など、WebView 自身のショートカット（F5、Ctrl+R、Ctrl+P、Ctrl+F など）は止めてある。割り当てを書けば、その動作になる
- 移動系のコマンドでは、押していた修飾キーが開き方（navigation.md）に使われる
- keyboard-global.xml（グローバルホットキー）は読まない

## execute と args

- `execute`：プログラムやファイルのパス。navigation.md の書き方（別名、環境変数）が使える。`AVESTA/...` と `/` 区切りも受け付ける
- `args` の置き換え：

| 書き方 | 置き換え |
|---|---|
| `{selected}` | 選択項目のフルパスを `"..."` で囲み、空白で区切って並べる |
| `[selected]` | 選択項目ごとに1回ずつ実行する。各回の `[selected]` は `"パス"` |
| `{current}` | current のフォルダのパス（`"..."` 付き） |

- 置き換えの前に、args に書かれた環境変数（`%LOCALAPPDATA%` など）を展開する（置き換えで入るファイル名の中の `%` は展開しない）
- `"..."` で囲むパスが `\` で終わるとき（`C:\` など）は、その `\` を二重にする（閉じの `"` が打ち消されないように）
- `execute` が `http://` / `https://` で始まるときは、既定のブラウザで開く
- 引数の中の `"` は、属性を `'...'` で囲むか `&quot;` と書く
- 作業フォルダは current のフォルダ

## config.json のオプション（Avesta の名前のまま）

| 名前 | 既定 | 意味 |
|---|---|---|
| DistinguishTab | true | タブのラベルを区別する |
| RestoreCond | true | 起動時にタブを復元する |
| RenameExtension | true | 名前の変更で拡張子を除いて選択する |
| FullRowSelect | false | 詳細で行全体を選択する |
| GridLine | false | 詳細で罫線を引く |
| OpenDups | false | 同じフォルダを重複して開く |
| LockClose | true | ロック中のタブも閉じる |
| PasteInFolder | false | 選んだフォルダの中へ貼り付ける |
| DnDCopyInterDrv | true | ドライブ間の DnD はコピー |
| Insert | tail | タブの追加位置：`head` / `tail` / `prev` / `next`（大文字で書いても読む） |
| ThumbnailSize | 96 | 縮小版のサイズ（64〜512） |
| FontSize | 12 | 文字の大きさ（px）。11 / 12 / 14 / 16 から選ぶ（`Option.FontSize.11` など）。ほかの値は 12 にする。Vesta だけのオプション |
| Columns | `["name","status","modified","type","size"]` | 詳細で表示する列と並び順（listing.md「列のカスタマイズ」）。ほかに `created`、`accessed`、`attributes`。Vesta だけのオプション |
| ColumnWidths | 名前 220、状態 48、更新日時 130 など | 詳細の列幅（px）。すべてのフォルダ・ペインで共通。Vesta だけのオプション |
| MenuVisible / ToolVisible / LinkVisible / StatusVisible | true | バーの表示 |

- 読み込むときに型と値を確かめ、合わないものは既定にする。この版にないキーは捨てる
