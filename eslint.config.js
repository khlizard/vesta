import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "reference"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  // The layers (AGENTS.md「書き方」): model <- api, config <- state <- commands <- root, presenters
  // <- components. A layer imports only from the ones to its left. Tests may reach further.
  ...[
    {
      layer: "model",
      above: ["state", "commands", "root", "presenters", "components"],
      also: ["**/api/backend", "**/config/store"],
      packages: ["zustand", "@tauri-apps/api/core", "@tauri-apps/api/event", "@tauri-apps/api/window"],
      why: "src/model/ holds pure functions: no store, no backend, nothing from the layers above.",
    },
    {
      layer: "api",
      above: ["state", "commands", "root", "presenters", "components"],
      also: [],
      packages: ["zustand"],
      why: "src/api/ only talks to the backend.",
    },
    {
      layer: "config",
      above: ["state", "commands", "root", "presenters", "components"],
      also: [],
      packages: [],
      why: "src/config/ is below the store and the commands (what exists is passed in: config/prune.ts).",
    },
    {
      layer: "state",
      above: ["commands", "root", "presenters", "components"],
      also: [],
      packages: [],
      why: "src/state/ does not know the commands, the root or the views.",
    },
    {
      layer: "commands",
      above: ["root", "presenters", "components"],
      also: [],
      packages: [],
      why: "src/commands/ does not know the root or the views.",
    },
    {
      layer: "presenters",
      above: ["root", "components"],
      also: ["**/api/backend"],
      packages: ["@tauri-apps/api/core"],
      why: "A presenter turns the stores into values to draw: no backend, nothing from the root or the views.",
    },
  ].map(({ layer, above, also, packages, why }) => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [{ group: [...above.map((d) => `**/${d}/*`), ...also], message: why }],
          paths: packages.map((name) => ({ name, message: why })),
        },
      ],
    },
  })),
  {
    // Views are passive (AGENTS.md「書き方」): they draw what their presenter gives them and tell
    // the root what happened. They do not reach the store, the commands or the backend.
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/state/*", "**/commands/*", "**/api/backend", "**/config/store", "**/config/load"],
              message: "A view reads through src/presenters/ and acts through dispatch (src/root/dispatch.ts).",
              allowTypeImports: true,
            },
          ],
          paths: [
            { name: "zustand", message: "A view reads through src/presenters/ (useView)." },
            { name: "@tauri-apps/api/core", message: "A view does not call the backend." },
          ],
        },
      ],
    },
  },
);
