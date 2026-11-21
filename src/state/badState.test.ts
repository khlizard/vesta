// A state file that cannot be read is set aside, not overwritten (docs/spec/config.md「置き場所」).
import { beforeEach, describe, expect, it, vi } from "vitest";

const files: Record<string, string | null> = {};

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("../api/backend", () => ({
  backend: {
    readState: vi.fn(async (name: string) => files[name] ?? null),
    writeState: vi.fn(async () => {}),
    keepBadState: vi.fn(async () => {}),
    logLine: vi.fn(async () => {}),
  },
}));

import { backend } from "../api/backend";
import { loadViews } from "./folderViews";
import { saveFailed } from "./log";
import { setMessage } from "./message";
import { loadOptions } from "./options";
import { restoreSession } from "./session";
import { DEFAULT_OPTIONS, getState, setState } from "./store";

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  vi.mocked(backend.keepBadState).mockClear();
  setState({ options: DEFAULT_OPTIONS });
  setMessage(null);
});

describe("a state file that cannot be read", () => {
  it("config.json: defaults stay, the file is kept aside and the user is told", async () => {
    files.config = "{ not json";
    await loadOptions();
    expect(getState().options).toEqual(DEFAULT_OPTIONS);
    expect(backend.keepBadState).toHaveBeenCalledWith("config");
    expect(getState().message).toContain("config.bad.json");
  });

  it("folders.json and session.json are kept aside too", async () => {
    files.folders = "[broken";
    await loadViews();
    expect(backend.keepBadState).toHaveBeenCalledWith("folders");
    files.session = "null";
    expect(await restoreSession()).toBe(false);
    expect(backend.keepBadState).toHaveBeenCalledWith("session");
  });

  it("nothing is set aside for a readable or a missing file", async () => {
    files.config = JSON.stringify({ ...DEFAULT_OPTIONS, GridLine: true });
    await loadOptions();
    expect(getState().options.GridLine).toBe(true);
    await loadViews();
    expect(await restoreSession()).toBe(false);
    expect(backend.keepBadState).not.toHaveBeenCalled();
    expect(getState().message).toBeNull();
  });
});

describe("a state file that cannot be written", () => {
  it("is reported in the status bar and the log", () => {
    saveFailed("config.json")("アクセスが拒否されました");
    expect(getState().message).toBe("config.json を保存できません: アクセスが拒否されました");
    expect(backend.logLine).toHaveBeenCalled();
  });
});
