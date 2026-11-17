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
