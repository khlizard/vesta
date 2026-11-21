# コマンド一覧

menu.xml、tool.xml、status.xml、keyboard-form.xml、keyboard-folder.xml の `command` に書ける名前の一覧。書式は [config.md](config.md)。

- 名前は Avesta と同じ（Vesta だけのものは「Vesta だけ」と書く）
- ここに無い名前の項目は表示されない（Avesta にあって Vesta に無い機能）。「設定ファイルを読み直す」（`Option.Reload`）のときに、使えなかった名前をステータスバーに出す
- `;` で区切ると、順に実行する（例：`Others.Close;Current.Refresh`）
- 「Current」は current のタブ（ペイン）のこと
- この一覧と実装は、テスト（`src/commands/commandsDoc.test.ts`）で突き合わせる

## 引数の書き方

| 書き方 | 意味 |
|---|---|
| `X.Show(true)` / `X.Show(false)` / `X.Show(toggle)` | 表示する / 隠す / 切り替える。省略すると toggle |
| `Tab[n]` | n 番目のタブ（1 から）。`Tab[2].Focus` のように書く |
| `Current.Lock(true)` / `(false)` / `(toggle)` | ロックする / 外す / 切り替える。省略すると toggle |

メニューのチェック、ツールバーとステータスバーの押し込みは、コマンドの状態に合わせて付く（例：`Current.Mode.Details` は詳細のとき、`Tab[2].Show(toggle)` は2番目のタブが表示中のとき）。

## ファイル

| コマンド | 動作 |
|---|---|
| `File.Open` | 場所を入力して開く |
| `File.MRU` | 最後に閉じたフォルダを開き直す。ツールバーに置くと、閉じたフォルダの一覧を出すドロップダウンが付く |
| `Current.NewFolder` | 新しいフォルダーを作り、名前の変更に入る |
| `Current.New` | 名前を入力して作る。拡張子があればファイル、なければフォルダ |
| `Current.Property` | プロパティ（選択が無ければ、フォルダ自身） |
| `RecycleBin.Empty` | ごみ箱を空にする |
| `System.Exit` | 終了する |

## 編集

| コマンド | 動作 |
|---|---|
| `Current.Undo` | 直前のファイル操作を元に戻す |
| `Current.Cut` | 切り取り |
| `Current.Copy` | コピー |
| `Current.Paste` | 貼り付け |
| `Current.Copy.Here` | 同じ場所に複製する（「- コピー」を付ける） |
| `Current.Delete` | ごみ箱へ移す |
| `Current.Bury` | 完全に削除する |
| `Current.Rename` | 名前の変更 |
| `Current.MoveToOther` | 隣のペインへ移動する |
| `Current.CopyToOther` | 隣のペインへコピーする |
| `Current.Copy.Path` | フルパスをクリップボードへ（選択が無ければ、フォルダのパス） |
| `Current.Copy.Name` | 名前をクリップボードへ |
| `Current.Copy.Base` | 拡張子を除いた名前をクリップボードへ |
| `Current.SelectAll` | すべて選択 |
| `Current.SelectNone` | 選択を解除 |
| `Current.SelectReverse` | 選択を反転 |
| `Current.SelectPattern` | ワイルドカードで選択 |

## 移動

移動のコマンドは、実行したときの修飾キーで開き方が変わる（[navigation.md](navigation.md)）。

| コマンド | 動作 |
|---|---|
| `Current.Go.Back` | 戻る |
| `Current.Go.Forward` | 進む |
| `Current.Go.Up` | 上のフォルダへ |
| `Current.Go.Location` | 場所を入力して移動する |
| `Address.Focus` | アドレスバーへフォーカスを移す |

## 表示

| コマンド | 動作 |
|---|---|
| `Current.Mode.Details` | 詳細 |
| `Current.Mode.Thumbnail` | 縮小版 |
| `Current.Grouping` | グループで表示（切り替え） |
| `Current.ShowAllFiles` | 隠しファイルを表示（切り替え） |
| `Current.Refresh` | 最新の情報に更新 |
| `Current.AdjustToItem` | 列の幅を中身に合わせる |
| `Current.AdjustToWindow` | 名前の列をペインの幅に合わせる |
| `Shown.AdjustToItem` | 表示中のペインすべての中身に合わせる |
| `Shown.AdjustToWindow` | `Current.AdjustToWindow` と同じ（列の幅は全ペインで共通のため） |
| `Menu.Show(toggle)` | メニューバーの表示。隠したあとは Alt で戻る |
| `Tool.Show(toggle)` | ツールバーの表示 |
| `Link.Show(toggle)` | リンクバーの表示 |
| `Status.Show(toggle)` | ステータスバーの表示 |

## タブ

X は、対象のタブの組。`Current`（current）、`All`（すべて）、`Left` / `Right`（current より左 / 右）、`Others`（current 以外）、`Shown`（表示中）、`Hidden`（隠れている）、`Duplicate`（同じフォルダを開いている、後ろのほう）。

| コマンド | 動作 |
|---|---|
| `Current.Close` | current のタブを閉じる |
| `All.Close` | すべて閉じる |
| `Left.Close` | 左側を閉じる |
| `Right.Close` | 右側を閉じる |
| `Others.Close` | ほかを閉じる |
| `Shown.Close` | 表示中を閉じる |
| `Hidden.Close` | 隠れているタブを閉じる |
| `Duplicate.Close` | 同じフォルダのタブを閉じる |
| `Current.Show(false)` | current のタブを表示する / 隠す |
| `All.Show(true)` | すべて表示する / 隠す |
| `Left.Show(true)` | 左側を表示する / 隠す |
| `Right.Show(true)` | 右側を表示する / 隠す |
| `Others.Show(false)` | ほかを表示する / 隠す |
| `Tab[n].Show(toggle)` | n 番目のタブを表示する / 隠す |
| `Tab[n].Focus` | n 番目のタブを current にする（隠れていれば表示する） |
| `Tab.New` | 新しいタブで PC を開いて current にする（表示中のタブはそのまま）。PC のタブが既にあれば、それを表示して current にする（`OpenDups` がオンなら、もう 1 つ開く）。Vesta だけのコマンド |
| `Tab.Next` | 表示中のタブのうち、右隣を current にする |
| `Tab.Prev` | 左隣を current にする |
| `Tab.Next2` | `Tab.Next` と同じ（Avesta の設定をそのまま読めるように残した別名） |
| `Tab.Prev2` | `Tab.Prev` と同じ（同上） |
| `Current.ToLeft` | current のタブを1つ左へ動かす |
| `Current.ToRight` | 1つ右へ動かす |
| `Current.Lock(toggle)` | ロック（ロック中のタブは、移動のたびに新しいタブを開く） |

## オプション

切り替えるたびに config.json に保存する。右の列は config.json のキー（[config.md](config.md)）。

| コマンド | 動作 | キー |
|---|---|---|
| `Option.RestoreConditions` | 起動時にタブを復元する | RestoreCond |
| `Option.DistinguishTab` | 同じ名前のタブを区別する | DistinguishTab |
| `Option.OpenDups` | 同じフォルダを重ねて開く | OpenDups |
| `Option.LockClose` | ロック中のタブも閉じる | LockClose |
| `Option.Insert.Head` | 新しいタブを左端に | Insert = head |
| `Option.Insert.Tail` | 新しいタブを右端に | Insert = tail |
| `Option.Insert.Prev` | 新しいタブを current の左に | Insert = prev |
| `Option.Insert.Next` | 新しいタブを current の右に | Insert = next |
| `Option.FullRowSelect` | 行全体で選択する | FullRowSelect |
| `Option.GridLine` | 罫線を引く | GridLine |
| `Option.RenameExtension` | 名前の変更で、拡張子を除いて選ぶ | RenameExtension |
| `Option.PasteInFolder` | 選んだフォルダの中へ貼り付ける | PasteInFolder |
| `Option.DnDCopyInterDrive` | 別のドライブへのドラッグはコピーにする | DnDCopyInterDrv |
| `Option.Thumbnail.64` | 縮小版の大きさ 64 | ThumbnailSize |
| `Option.Thumbnail.96` | 縮小版の大きさ 96 | ThumbnailSize |
| `Option.Thumbnail.128` | 縮小版の大きさ 128 | ThumbnailSize |
| `Option.Thumbnail.192` | 縮小版の大きさ 192 | ThumbnailSize |
| `Option.Thumbnail.256` | 縮小版の大きさ 256 | ThumbnailSize |
| `Option.FontSize.11` | 文字の大きさ 小（Vesta だけ） | FontSize |
| `Option.FontSize.12` | 文字の大きさ 標準（Vesta だけ） | FontSize |
| `Option.FontSize.14` | 文字の大きさ 大（Vesta だけ） | FontSize |
| `Option.FontSize.16` | 文字の大きさ 特大（Vesta だけ） | FontSize |
| `Option.TwoRows` | ペインが多いときに2段に並べる（実験的な機能、Vesta だけ） | TwoRows |
| `Option.Reload` | 設定ファイル（usr/*.xml）を読み直す | |

## そのほか

| コマンド | 動作 |
|---|---|
| `System.About` | バージョン情報 |
| `System.Update` | ダウンロード済みの更新を入れて再起動する（Vesta だけ。更新が無いときは押せない） |

## コマンド以外の属性

`command` の代わりに、次の属性も書ける（[config.md](config.md)）。

| 属性 | 動作 |
|---|---|
| `navigate="場所"` | その場所を開く |
| `execute="プログラム" args="引数"` | プログラムを実行する。`http://` / `https://` ならブラウザで開く |
| `path="場所"`（link.xml） | フォルダなら開き、ファイルなら実行する |
