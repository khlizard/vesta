// Per-pane address bar. Spec: docs/spec/navigation.md「アドレスバー」

import { useEffect, useRef, useState } from "react";
import { backend, iconUrl } from "../api/backend";
import type { FolderInfo } from "../api/types";
import { compareNames } from "../model/sort";
import { setMessage } from "../state/message";
import { navigate, openInput } from "../state/navigation";
import { dragStarted, errorText, isImeKey, modsOf } from "../model/input";
import type { Mods } from "../model/navigation";
import { trackPointer } from "./pane/pointer";
import "../styles/pane.css";

const MAX_SUGGEST = 20;

interface Props {
  id: string;
  folder: FolderInfo | null;
  current: boolean;
}

/** Splits typed text into the parent to list and the name prefix, or null when there is no `\` or `/`. */
export function splitTyped(text: string): { parent: string; prefix: string } | null {
  const i = Math.max(text.lastIndexOf("\\"), text.lastIndexOf("/"));
  if (i < 0) return null;
  return { parent: text.slice(0, i + 1), prefix: text.slice(i + 1) };
}

/** The folder to list for a typed parent: `/` as `\`, and `~\…` resolved to the profile folder. */
async function listableParent(parent: string): Promise<string> {
  const p = parent.replace(/\//g, "\\");
  if (!p.startsWith("~\\")) return p;
  const r = await backend.resolveLocation(p);
  if (r.kind !== "folder") throw new Error("not a folder");
  return r.folder.location;
}

export function AddressBar({ id, folder, current }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const display = folder?.fsPath ?? folder?.displayName ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [ancestors, setAncestors] = useState<FolderInfo[] | null>(null);
  const [suggest, setSuggest] = useState<{ parent: string; names: string[] }>({ parent: "", names: [] });
  const [pick, setPick] = useState(-1);
  const folderCache = useRef<{ parent: string; names: string[] } | null>(null);
  const reqSeq = useRef(0);

  const focusList = () => {
    rootRef.current?.closest("[data-drop-pane]")?.querySelector<HTMLElement>("[data-pane-list]")?.focus();
  };

  const restore = () => {
    setDraft(null);
    folderCache.current = null;
    setSuggest({ parent: "", names: [] });
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
    const t = splitTyped(text);
    if (!t) {
      setSuggest({ parent: "", names: [] });
      return;
    }
    let names: string[];
    if (folderCache.current?.parent.toLowerCase() === t.parent.toLowerCase()) {
      names = folderCache.current.names;
    } else {
      try {
        const listing = await backend.listFolder(await listableParent(t.parent), false);
        names = listing.entries
          .filter((e) => e.isFolder)
          .map((e) => e.name)
          .sort(compareNames);
        folderCache.current = { parent: t.parent, names };
      } catch {
        names = [];
      }
    }
    if (seq !== reqSeq.current) return;
    const lower = t.prefix.toLowerCase();
    setSuggest({ parent: t.parent, names: names.filter((n) => n.toLowerCase().startsWith(lower)).slice(0, MAX_SUGGEST) });
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
