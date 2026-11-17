// Modal dialogs driven by `dialog` in the store, plus the popup host.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { formatBuildTime } from "../model/buildTime";
import { isImeKey, modsOf } from "../model/input";
import { PopupHost } from "./PopupMenu";
import { openExternal, openInput } from "../state/navigation";
import { newItem } from "../state/fileActions";
import { selectPattern } from "../state/selection";
import { currentPaneId, setState, useStore } from "../state/store";
import { NO_MODS, type Mods } from "../model/navigation";
import "../styles/chrome.css";

const close = () => setState({ dialog: null });

/** Inputs given to File.Open during this session, newest first (max 20). */
let locationHistory: string[] = [];

function remember(text: string) {
  locationHistory = [text, ...locationHistory.filter((h) => h !== text)].slice(0, 20);
}

function Frame(props: { title: string; onOk?: () => void; okText?: string; children: ReactNode }) {
  const hasOk = !!props.onOk;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" || (!hasOk && e.key === "Enter")) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasOk]);
  return (
    <div className="dlg-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="dlg"
        role="dialog"
        aria-label={props.title}
      >
        <div className="dlg-title">{props.title}</div>
        <div className="dlg-body">{props.children}</div>
        <div className="dlg-buttons">
          {props.onOk && (
            <button type="button" className="dlg-btn default" onClick={props.onOk}>
              {props.okText ?? "OK"}
            </button>
          )}
          <button type="button" className="dlg-btn" onClick={close}>
            {props.onOk ? "キャンセル" : "閉じる"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TextDialogProps {
  title: string;
  label: string;
  initial: string;
  /** Selects only this many leading characters initially (default: everything). */
  selectLength?: number;
  history?: string[];
  onConfirm: (text: string, mods: Mods) => void;
}

function TextDialog({ title, label, initial, selectLength, history, onConfirm }: TextDialogProps) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, selectLength ?? el.value.length);
  }, [selectLength]);

  const ok = (mods: Mods) => onConfirm(text, mods);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isImeKey(e)) {
      e.preventDefault();
      ok(modsOf(e));
    }
  };
  return (
    <Frame title={title} onOk={() => ok(NO_MODS)}>
      <label className="dlg-label">
        {label}
        <input
          ref={input}
          className="dlg-input"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      {history && history.length > 0 && (
        <ul className="dlg-history">
          {history.map((h) => (
            <li
              key={h}
              onClick={() => {
                setText(h);
                input.current?.focus();
              }}
              onDoubleClick={() => onConfirm(h, NO_MODS)}
            >
              {h}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function AboutDialog() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    let alive = true;
    getVersion().then(
      (v) => alive && setVersion(v),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Frame title="バージョン情報">
      <div className="dlg-about">
        <div className="dlg-about-name">Vesta</div>
        <div>バージョン {version}</div>
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
  const dialog = useStore((s) => s.dialog);
  return (
    <>
      <PopupHost />
      {dialog?.kind === "location" && (
        <TextDialog
          title="開く"
          label="開く場所:"
          initial=""
          history={locationHistory}
          onConfirm={(text, mods) => {
            const input = text.trim() || "HOME";
            remember(input);
            close();
            void openExternal(input, mods);
          }}
        />
      )}
      {dialog?.kind === "goLocation" && (
        <TextDialog
          title="場所を指定"
          label="移動する場所:"
          initial={dialog.initial ?? ""}
          onConfirm={(text, mods) => {
            close();
            void openInput(text.trim() || "HOME", mods, currentPaneId());
          }}
        />
      )}
      {dialog?.kind === "newFile" && (
        <TextDialog
          title="新規作成"
          label="名前（拡張子がなければフォルダ）:"
          initial={dialog.initial ?? ""}
          selectLength={
            (dialog.initial ?? "").lastIndexOf(".") > 0 ? (dialog.initial ?? "").lastIndexOf(".") : undefined
          }
          onConfirm={(text) => {
            close();
            void newItem(currentPaneId(), text);
          }}
        />
      )}
      {dialog?.kind === "pattern" && (
        <TextDialog
          title="パターンを指定して選択"
          label="パターン (; 区切り):"
          initial={dialog.initial ?? "*"}
          onConfirm={(text) => {
            close();
            const id = currentPaneId();
            if (id) selectPattern(id, text);
          }}
        />
      )}
      {dialog?.kind === "about" && <AboutDialog />}
    </>
  );
}
