# タブとペイン

元の実装：`reference/Avestan/src/mew/widgets/Tab.cpp`、`src/server/main.cpp`

## タブの状態

| 状態 | 意味 |
|---|---|
| shown | ペインとして表示されている。常に1つ以上は shown |
| locked | ナビゲートロック。移動系の操作が新しいタブを開く動作に変わる（navigation.md） |
| current | キー操作やコマンドの対象。shown のタブだけがなれる。1つだけ |

current のタブが hidden になったり閉じられたりしたら、次の shown タブが current になる。

## タブバーの操作

| 操作 | 動作 |
|---|---|
| 左クリック | そのタブだけを shown にし（ほかはロック中も含めて hidden）、current にする |
| Ctrl+クリック | shown を切り替える。shown にしたら current にする |
| ダブルクリック | shown にして、locked を切り替える |
| 中クリック | 閉じる。`LockClose` がオフなら、ロック中のタブは閉じない |
| 左ドラッグ | 並べ替え。隣のタブの中央を越えたら入れ替える |
| ホイール | shown が1つなら、次/前のタブだけを表示する。2つ以上なら、current のペインを次の「ロックされていない hidden タブ」と入れ替える |
| 右クリック | メニュー：閉じる、表示、ナビゲートロック、左側/右側/他/表示中/非表示/すべてを閉じる |
| ファイルをドロップ | そのタブのフォルダへコピー/移動する |
| ドラッグ中に hidden タブの上で 500ms 待つ | そのタブを shown に加える |

## 見た目

| 状態 | 描画 |
|---|---|
| shown | ボタン面の色で塗る |
| hidden | 塗らない（バーの背景のまま）。右に区切り線 |
| current | 太字 |
| current 以外 | 灰色の文字 |
| locked | 赤字 |
| ホバー | 下線 |

- タブは複数行に折り返す
- 文字は中央寄せ。長いものは省略する
- 幅は `TabWidthMin`=60px から `TabWidthMax`=200px
- ツールチップにフルパスを表示する

## ラベル（DistinguishTab）

- オン（既定）：パスの末尾から N 個の部分をつなげる。N は 1 から始め、ほかのタブのラベルと（大文字小文字を区別せずに）同じあいだは増やす。区切りは `\`（日本語フォントでは `¥` に見える）
  - 例：`D:\Data\dev` と `D:\Work\dev` → `Data\dev` と `Work\dev`
- オフ：パスの末尾の部分だけ
- 仮想フォルダ（PC、ごみ箱など）は表示名を使う
- 元の実装はタブの作成時と名前変更時にしか計算し直さないが、この実装ではタブが変わるたびにすべて計算し直す

## ペインの配置（横並びのみ。Arrange.* のコマンドは入れない）

- shown のタブを、タブバーの順に左から並べる
- 幅は等分する（`width / n`。余りは右端のペインに足す）
- ペインの境界はドラッグで幅を変えられる。並べ直し（ウィンドウのリサイズ、表示の切り替え、タブの増減）で等幅に戻る
- ペインのどこかをクリックすると、そのペインが current になる

## タブの追加位置（Option.Insert）

Head（先頭）、Tail（末尾、既定）、Prev（current の左）、Next（current の右）。
新しいタブは hidden で追加し、そのあと開き方（navigation.md）に従って状態を決める。

## 閉じる系のコマンド

| コマンド | 対象 |
|---|---|
| Current.Close | current |
| All.Close | すべて |
| Left.Close / Right.Close | current より左/右 |
| Shown.Close / Hidden.Close | shown / hidden のすべて |
| Others.Close | current 以外 |
| Duplicate.Close | 同じフォルダを開いているタブの2つ目以降 |

- `LockClose` がオフのときは、ロック中のタブを閉じない
- 閉じたタブのフォルダは MRU（最近閉じたフォルダ、最大10件。重複は先頭へ移す）に入る
- タブがすべてなくなっても、アプリは終了しない（空の画面にする）

## 表示系のコマンド

- `X.Show(true|false|toggle)`。X は Current、All、Left、Right、Others、Tab[n]
- `Tab[n].Focus`：n 番目のタブを current にする（hidden なら shown にする）
- `Tab.Next` / `Tab.Prev`：shown のタブの中で current を移す
- `Current.ToLeft` / `Current.ToRight`：current のタブを1つ左/右へ移す
