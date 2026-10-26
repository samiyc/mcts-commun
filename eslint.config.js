import js from "@eslint/js";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";

/**
 * Flat config, the projects' (Sami, 26/10/2026: the tooling mcts-commun missed), with lopin's complexity budget:
 * a module that outgrows it gets split, the limit does not get raised. node/ and bin/ are the backlog's tools, plain
 * Node, under the same budget.
 */
const COMPLEXITY_BUDGET = {
  complexity: ["error", { max: 8 }],
  "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
  "max-lines": ["error", { max: 220, skipBlankLines: true, skipComments: true }],
  "max-depth": ["error", 3],
  "max-params": ["error", 4],
  "max-statements": ["error", 20],
  "max-nested-callbacks": ["error", 2],
  "sonarjs/cognitive-complexity": ["error", 10],
};

const COMMON_RULES = {
  eqeqeq: ["error", "always"],
  "no-var": "error",
  "prefer-const": "error",
  "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
};

const MODULE = { ecmaVersion: 2022, sourceType: "module" };

export default [
  { ignores: ["node_modules/**", "coverage/**", "tmp/**", "logs/**", ".idea/**", ".claude/**"] },

  js.configs.recommended,
  sonarjs.configs.recommended,

  {
    // The library and the page run in the browser too: no Node built-in may creep in.
    files: ["src/**/*.js", "web/**/*.js"],
    languageOptions: { ...MODULE, globals: {} },
    rules: {
      ...COMPLEXITY_BUDGET,
      ...COMMON_RULES,
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*"], message: "Code partagé avec le navigateur : pas de module Node." }] }],
    },
  },

  {
    // The backlog's page: browser ES modules served by `npm run page`.
    files: ["web/**/*.js"],
    languageOptions: { globals: globals.browser },
  },

  {
    // The backlog's runner, its views and the page server: plain Node.
    files: ["node/**/*.js", "bin/**/*.js"],
    languageOptions: { ...MODULE, globals: globals.node },
    rules: { ...COMPLEXITY_BUDGET, ...COMMON_RULES },
  },

  {
    files: ["tests/**/*.js"],
    languageOptions: { ...MODULE, globals: globals.node },
    rules: {
      ...COMPLEXITY_BUDGET,
      ...COMMON_RULES,
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "max-nested-callbacks": ["error", 4],
      "sonarjs/no-duplicate-string": "off",
    },
  },

  {
    files: ["*.js"],
    languageOptions: { ...MODULE, globals: globals.node },
  },
];
