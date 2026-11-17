// Per-pane address bar. Spec: docs/spec/navigation.md「アドレスバー」

import { useEffect, useRef, useState } from "react";
import { backend, iconUrl } from "../api/backend";
import type { FolderInfo } from "../api/types";
import { createSuggester, NO_SUGGESTION, type Suggestion } from "../state/address";
import { setMessage } from "../state/message";
import { navigate, openInput } from "../state/navigation";
import { dragStarted, errorText, isImeKey, modsOf } from "../model/input";
import type { Mods } from "../model/navigation";
import { trackPointer } from "./pane/pointer";
import "../styles/pane.css";

interface Props {
  id: string;
  folder: FolderInfo | null;
  current: boolean;
}

export function AddressBar({ id, folder, current }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const display = folder?.fsPath ?? folder?.displayName ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [ancestors, setAncestors] = useState<FolderInfo[] | null>(null);
  const [suggest, setSuggest] = useState<Suggestion>(NO_SUGGESTION);
  const [pick, setPick] = useState(-1);
  const [suggester] = useState(() => ({ current: createSuggester() }));
  const reqSeq = useRef(0);

  const focusList = () => {
    rootRef.current?.closest("[data-drop-pane]")?.querySelector<HTMLElement>("[data-pane-list]")?.focus();
  };

  const restore = () => {
    setDraft(null);
    suggester.current.reset();
    setSuggest(NO_SUGGESTION);
    setPick(-1);
  };

  useEffect(() => {
    const onFocus = (e: Event) => {
      if ((e as CustomEvent).detail !== id) return;
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("vesta:focus-address", onFocus);
    return () => window.removeEventListener("vesta:focus-address", onFocus);
  }, [id]);

  // Close the dropdown on outside clicks.
  const open = ancestors !== null;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setAncestors(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const openDropdown = async () => {
    if (!folder) return;
    try {
      setAncestors(await backend.folderAncestors(folder.location));
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  const updateSuggest = async (text: string) => {
    const seq = ++reqSeq.current;
    const found = await suggester.current.suggest(text);
    // Typed on since: a newer lookup is under way.
    if (seq !== reqSeq.current) return;
    setSuggest(found);
    setPick(-1);
  };

  const commit = async (value: string, mods: Mods) => {
    const input = value.trim();
    if (!input) return;
    if (!(await openInput(input, mods, id))) return;
    restore();
    focusList();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    // Keys used by a Japanese conversion (Enter to confirm, arrows, Esc) belong to the IME.
    if (isImeKey(e)) return;
    const mods = modsOf(e);
    const n = suggest.names.length;
    if (e.key === "Enter") {
      e.preventDefault();
      const value = pick >= 0 && suggest.names[pick] ? suggest.parent + suggest.names[pick] : (draft ?? display);
      void commit(value, mods);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      restore();
      setAncestors(null);
      focusList();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setPick((p) => (p + 1) % n);
      else void openDropdown();
    } else if (e.key === "ArrowUp" && n) {
      e.preventDefault();
      setPick((p) => (p <= 0 ? n - 1 : p - 1));
    }
  };

  const onIconPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !folder) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const loc = folder.location;
    const stop = trackPointer(
      (ev) => {
        if (!dragStarted(ev.clientX - sx, ev.clientY - sy)) return;
        stop();
        backend.startDrag([loc]).catch((err) => setMessage(errorText(err)));
      },
      () => {},
    );
  };

  const onIconContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!folder) return;
    backend.showContextMenu(folder.parent ?? "DESKTOP", [folder.location], e.clientX, e.clientY).catch((err) => setMessage(errorText(err)));
  };

  return (
    <div ref={rootRef} className={`address${current ? " current" : ""}`}>
      <div className="address-box">
        {folder && (
          <img
            className="address-icon"
            // Inside a cloud sync root (Dropbox, OneDrive...): the root's icon.
            src={iconUrl(folder.syncRootPath ?? folder.location)}
            draggable={false}
            alt=""
            onPointerDown={onIconPointerDown}
            onContextMenu={onIconContextMenu}
          />
        )}
        <input
          ref={inputRef}
          className="address-input"
          value={draft ?? display}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            void updateSuggest(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            restore();
          }}
          onWheel={() => {
            if (!open) void openDropdown();
          }}
        />
        <button
          className="address-drop"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? setAncestors(null) : void openDropdown())}
        >
          ▼
        </button>
      </div>
      {open && ancestors && (
        <div className="address-menu" role="listbox">
          {ancestors.map((f, i) => (
            <div
              key={f.location}
              className={`address-item${i === ancestors.length - 1 ? " here" : ""}`}
              style={{ paddingLeft: 4 + i * 12 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                setAncestors(null);
                void navigate(id, f.location, modsOf(e));
                focusList();
              }}
            >
              <img src={iconUrl(f.location)} draggable={false} alt="" />
              <span>{f.displayName}</span>
            </div>
          ))}
        </div>
      )}
      {!open && suggest.names.length > 0 && draft !== null && (
        <div className="address-menu" role="listbox">
          {suggest.names.map((name, i) => (
            <div
              key={name}
              className={`address-item${i === pick ? " picked" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                void commit(suggest.parent + name, modsOf(e));
              }}
            >
              <img src={iconUrl(suggest.parent + name)} draggable={false} alt="" />
              <span>{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
