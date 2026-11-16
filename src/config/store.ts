// Current bar / key configuration: empty until usr/*.xml is loaded at startup (src/config/load.ts).
// The defaults live in src-tauri/resources/usr/*.xml (written to usr/ on first run).
import { create } from "zustand";
import type { UiConfig } from "./types";

export const EMPTY_UI_CONFIG: UiConfig = { menu: [], tool: [], status: [], link: [], keyForm: [], keyFolder: [] };

export const useConfig = create<UiConfig>(() => EMPTY_UI_CONFIG);
