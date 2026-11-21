# フォルダの移動と開き方

元の実装：`reference/Avestan/src/server/callback.cpp:179-225`、`src/server/main.cpp:540-640`

## 開き方（Action）

| Action | 動作 |
|---|---|
| Goto | 対象のペインがその場で移動する |
| GotoAlways | ロック中でもその場で移動する |
| Open | 新しいタブを開き、そのタブだけを shown にして current にする |
| Append | 新しいタブを shown で追加する。current は変えない |
| Reserve | 新しいタブを hidden で追加する |
| Replace | 新しいタブを開いて current にする。元のタブはロックを外して hidden にする |
| Switch | 新しいタブを shown で追加し、current にする |
| Cancel | 何もしない |

`OpenDups` がオフ（既定）のとき、そのフォルダを開いているタブが既にあれば、新しいタブを作らずにそのタブを使う。

## 一覧の中で移動するとき（ダブルクリック、Enter、戻る、進む、上へ、アドレスバー）

| 修飾キー | ロックなしのタブ | ロック中のタブ |
|---|---|---|
| なし | Goto | Append |
| Ctrl | Append | Goto |
| Shift | Reserve | Reserve |
| Ctrl+Shift | Replace | Append |
| Shift+Alt | Switch | Switch |
| Ctrl+Alt | GotoAlways | GotoAlways |

## 外から開くとき（リンクバー、File.Open、MRU、ドロップ、起動引数）

| 修飾キー | Action |
|---|---|
| なし | Open |
| Ctrl | Append |
| Shift | Reserve |
| Ctrl+Shift | Replace |
| Shift+Alt | Switch |

- リンクバーのメニューでは、項目のクリック、Enter、アクセスキーのどれで選んでも、そのときの修飾キーをこの表に当てはめる（例：Ctrl を押しながらアクセスキーを押すと Append。今の表示はそのままで、横にペインが増える）。中クリックは Ctrl として扱う
- 複数のフォルダをまとめて開くとき（複数選択して Enter）は、修飾キーに関係なく、すべて Append で開く

## 履歴

- タブごとに戻る/進むの履歴を持つ
- `Current.Go.Up` は親フォルダへ移動する。ドライブのルートからは PC へ、PC からはデスクトップへ
- 移動したら、移動前のフォルダを選択状態にする（上へ移動したときに、元いたフォルダにカーソルを合わせる）

## ファイルを開く（実行）

- ダブルクリックや Enter で、ShellExecuteEx の既定の動作（verb なし）を行う
- 複数選択していたら、それぞれを実行する。フォルダが含まれていたら、フォルダは上の表に従って開く
- .lnk がフォルダを指していたら、フォルダとして扱う（Explorer を開かず、上の表に従ってその場で移動するか、タブで開く）
  - 書かれている行き先が無くなっていたら（フォルダを移動した、ドライブ文字が変わったなど）、Windows がショートカットを開くときと同じ方法で探す（ショートカットからの相対位置など。最長 1 秒）。探すだけで、ショートカットのファイルは書き換えない。見つからなければ、ふつうのファイルとして実行する（Windows が探すダイアログを出す）

## アドレスバー（ペインごと）

- 普段は現在のパスを表示する。仮想フォルダは表示名を表示する
- アイコンは今のフォルダのアイコン。クラウドの同期ルート（Dropbox、OneDrive、iCloud Drive など）の配下では、その同期ルートのアイコンを出す（どのサービスの中にいるかが分かるように）。ドロップダウンの先祖は、それぞれのフォルダのアイコンのまま
- ドロップダウン：先祖のフォルダを、デスクトップまでアイコン付きで並べる。下の階層ほど字下げする。選ぶとそこへ移動する
- 編集：入力中はファイルシステムのパスを補完する。Enter で、フォルダなら移動（上の表に従う）、ファイルなら実行する
- Esc または Tab：入力を元に戻して、一覧にフォーカスを移す
- ↓ キーまたはホイール：ドロップダウンを開く

## 場所の書き方（link.xml、アドレスバー、設定で共通）

- フルパス：`C:\foo`、`C:`（`C:\` とみなす）
- UNC：`\\server`（共有の一覧）、`\\server\share`
- 環境変数：`%TEMP%`、`%USERPROFILE%\Desktop`
- `~`：ユーザーフォルダ（別名の `PROFILE` と同じ）。`~/Downloads`、`~\Desktop`。先頭の `~` だけを読む。`~user`（ほかのユーザー）や、途中の `~` は読まない。起動引数でも同じ。アドレスバーの補完も `~\` の先で効く
- シェルの GUID：`::{20D04FE0-3AEA-1069-A2D8-08002B30309D}`
- 別名（大文字小文字を区別しない。`別名\サブパス` も可）

| 別名 | 場所 |
|---|---|
| DESKTOP | デスクトップ（仮想） |
| DESKTOPDIRECTORY | デスクトップの実フォルダ |
| DRIVES, DRIVE | PC |
| HOME, MYDOCUMENTS, PERSONAL | ドキュメント |
| MYMUSIC, MYPICTURES, MYPICTURE, MYVIDEO, MYVIDEOS | ミュージック、ピクチャ、ビデオ |
| PROFILE, ~ | ユーザーフォルダ |
| CONTROLS, CONTROLPANEL, CONTROL | コントロールパネル |
| BITBUCKET, RECYCLEBIN, TRASH | ごみ箱 |
| NETWORK, NETHOOD | ネットワーク |
| PROGRAM_FILES | C:\Program Files |
| SYSTEM | C:\Windows\System32 |
| WINDOWS | C:\Windows |
| AVESTA、VESTA | アプリの設定フォルダ（usr/ の親） |
