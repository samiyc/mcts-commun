import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A Markdown file stays readable in one sitting (Sami, 26/10/2026, from lopin's tests/web-cli/md-budget.test.js):
 * a longer one splits into chapters. CLAUDE.md is read at every session, so it gets a
 * tighter cap. The ignored folders are not ours to budget.
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MD_LINE_LIMIT = 800;
const CLAUDE_LINE_LIMIT = 300;
const SKIPPED = new Set(["node_modules", ".git", ".claude", "tmp", "logs", "coverage"]);

const markdownUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : markdownUnder(join(dir, entry.name));
    return entry.name.endsWith(".md") ? [join(dir, entry.name)] : [];
  });

const lineCount = (file) => readFileSync(file, "utf8").split(/\r?\n/).length - 1;

describe("the Markdown budget", () => {
  it("keeps every .md under 800 lines: a longer one splits into chapters", () => {
    const long = markdownUnder(ROOT)
      .map((file) => ({ file: relative(ROOT, file), lines: lineCount(file) }))
      .filter(({ lines }) => lines > MD_LINE_LIMIT);
    const named = long.map(({ file, lines }) => `${file} (${lines} lignes)`).join(", ");
    assert.deepEqual(long, [], `trop longs, à découper en chapitres : ${named}`);
  });

  it("keeps CLAUDE.md under 300 lines: it is read at every session", () => {
    assert.ok(lineCount(join(ROOT, "CLAUDE.md")) <= CLAUDE_LINE_LIMIT, "CLAUDE.md : resserrer avant d'ajouter");
  });
});
