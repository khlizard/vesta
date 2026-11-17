// Modal dialogs: which one is open, and what it holds, comes from the root's state.
// Spec: docs/spec/ui.md「モード」

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { formatBuildTime } from "../model/buildTime";
import { isImeKey, modsOf } from "../model/input";
import { NO_MODS, type Mods } from "../model/navigation";
import { dialogView, type DialogVM } from "../presenters/chrome";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import "../styles/chrome.css";

function Frame(props: { title: string; onOk?: () => void; children: ReactNode }) {
  return (
    // Nothing behind the dialog is pressed through it.
    <div className="dlg-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div className="dlg" role="dialog" aria-label={props.title}>
        <div className="dlg-title">{props.title}</div>
        <div className="dlg-body">{props.children}</div>
        <div className="dlg-buttons">
          {props.onOk && (
            <button type="button" className="dlg-btn default" onClick={props.onOk}>
              OK
            </button>
          )}
          <button type="button" className="dlg-btn" onClick={() => dispatch({ type: "dialog.close" })}>
            {props.onOk ? "キャンセル" : "閉じる"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TextDialog({ vm }: { vm: Extract<DialogVM, { kind: "text" }> }) {
  // The text being typed is the dialog's own until it is confirmed.
  const [text, setText] = useState(vm.initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, vm.selectLength ?? el.value.length);
  }, [vm.selectLength]);

  const confirm = (value: string, mods: Mods) => dispatch({ type: "dialog.confirm", text: value, mods });
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter that confirms a Japanese conversion is not the end of the input.
    if (e.key === "Enter" && !isImeKey(e)) {
      e.preventDefault();
      confirm(text, modsOf(e));
    }
  };
  return (
    <Frame title={vm.title} onOk={() => confirm(text, NO_MODS)}>
      <label className="dlg-label">
        {vm.label}
        <input
          ref={input}
          className="dlg-input"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      {vm.history.length > 0 && (
        <ul className="dlg-history">
          {vm.history.map((h) => (
            <li
              key={h}
              onClick={() => {
                setText(h);
                input.current?.focus();
              }}
              onDoubleClick={() => confirm(h, NO_MODS)}
            >
              {h}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function AboutDialog({ vm }: { vm: Extract<DialogVM, { kind: "about" }> }) {
  return (
    <Frame title={vm.title}>
      <div className="dlg-about">
        <div className="dlg-about-name">Vesta</div>
        <div>バージョン {vm.version}</div>
        <div>ビルド {formatBuildTime(__BUILD_TIME__)}</div>
        <p>
          タブ型ファイラ Avesta を参考に、使いやすい形でリメイクしたものです。
          <br />
          https://github.com/khlizard/vesta
          <br />
          MIT ライセンス。アイコンは Lucide（ISC ライセンス）。
        </p>
      </div>
    </Frame>
  );
}

export function Dialogs() {
  const vm = useView(dialogView);
  if (!vm) return null;
  // `key`: a dialog opened anew starts from its own initial text.
  return vm.kind === "about" ? <AboutDialog vm={vm} /> : <TextDialog key={vm.title} vm={vm} />;
}
