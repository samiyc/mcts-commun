import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PROJECTS } from "../../node/board/board.js";
import { projectColor } from "../../web/backlog/html.js";

const CSS = readFileSync(new URL("../../web/backlog.css", import.meta.url), "utf8");

describe("the page's project colours (Sami, 10/11/2026: raquette, feux and economie were grey)", () => {
  it("gives every project that runs jobs its own colour, light and dark", () => {
    for (const name of PROJECTS.filter((one) => one !== "commun")) {
      assert.equal(projectColor(name), `var(--${name})`, name);
      assert.equal(CSS.split(`--${name}:`).length - 1, 2, `${name}: a colour in light and in dark`);
    }
  });

  it("leaves a name it does not know grey", () => {
    assert.equal(projectColor("inconnu"), "var(--other)");
  });
});
