import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextSpeed, replayHint, replayKeys, within } from "../src/replay-keys.js";

/**
 * The keys of a replay (src/replay-keys.js, Sami 29/10/2026), checked as mcts-cuisine checked its own
 * (tests/player-keys.test.js): a player at 40 of 200 writes down what the keys ask.
 */
function playerAt(t = 40, end = 200) {
  const asked = [];
  return { asked, t: () => t, end: () => end, seek: (to) => asked.push(["seek", to]), toggle: () => asked.push(["toggle"]), faster: (way) => asked.push(["faster", way]) };
}

/** A keydown on the page (`on`: the tag the focus is in), and whether it was prevented. */
function keydown(key, { code = "", on = "body", ...modifiers } = {}) {
  const event = { key, code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...modifiers, prevented: false };
  return Object.assign(event, { target: { closest: (tags) => (tags.split(", ").includes(on) ? {} : null) }, preventDefault: () => (event.prevented = true) });
}

const SPEEDS = [
  ["0.5", "×0,5"],
  ["1", "×1"],
  ["4", "×4"],
  ["10", "×10"],
];

describe("the keys of a replay (src/replay-keys.js)", () => {
  it("plays or pauses with space, moves a step or a big one with Shift, changes the speed, goes to a tenth", () => {
    const key = replayKeys({ step: 10, bigStep: 50 });
    const player = playerAt();
    for (const event of [keydown(" "), keydown("ArrowLeft"), keydown("ArrowRight", { shiftKey: true }), keydown("ArrowUp"), keydown("ArrowDown"), keydown("7")]) {
      assert.equal(key(player, event), true, event.key);
      assert.equal(event.prevented, true, event.key);
    }
    assert.deepEqual(player.asked, [["toggle"], ["seek", 30], ["seek", 90], ["faster", 1], ["faster", -1], ["seek", 140]]);
  });

  it("reads a figure by its place: the AZERTY row, the keypad with num lock off, but its arrows", () => {
    const key = replayKeys({ step: 10, bigStep: 50 });
    const player = playerAt();
    assert.equal(key(player, keydown("è", { code: "Digit7" })), true);
    assert.equal(key(player, keydown("End", { code: "Numpad1" })), true);
    assert.equal(key(player, keydown("ArrowLeft", { code: "Numpad4" })), true);
    assert.equal(key(player, keydown("Clear", { code: "Numpad5" })), true);
    assert.deepEqual(player.asked, [["seek", 140], ["seek", 20], ["seek", 30], ["seek", 100]]);
  });

  it("leaves a field's keys, space on a button, a key with Ctrl, Alt or Meta, and the others", () => {
    const key = replayKeys({ step: 10, bigStep: 50 });
    const player = playerAt();
    const left = [keydown("ArrowUp", { on: "select" }), keydown("5", { on: "input" }), keydown("ArrowLeft", { on: "textarea" }), keydown(" ", { on: "button" }), keydown("ArrowLeft", { ctrlKey: true }), keydown("1", { altKey: true }), keydown("r", { metaKey: true }), keydown("a"), keydown("e")];
    for (const event of left) {
      assert.equal(key(player, event), false, event.key);
      assert.equal(event.prevented, false, event.key);
    }
    assert.equal(key(player, keydown("ArrowRight", { on: "button" })), true, "an arrow on a button is the replay's");
    assert.deepEqual(player.asked, [["seek", 50]]);
  });

  it("keeps the time within the replay, in minutes or to whole turns", () => {
    const minutes = replayKeys({ step: 10, bigStep: 60 });
    const player = playerAt(55.5, 487.25);
    for (const event of [keydown("ArrowLeft", { shiftKey: true }), keydown("ArrowRight"), keydown("9")]) minutes(player, event);
    const turns = replayKeys({ step: 12, bigStep: 60, whole: true });
    const end = playerAt(1430, 1437);
    for (const event of [keydown("ArrowRight"), keydown("3"), keydown("ArrowLeft", { shiftKey: true })]) turns(end, event);
    assert.deepEqual(player.asked, [["seek", 0], ["seek", 65.5], ["seek", 438.525]]);
    assert.deepEqual(end.asked, [["seek", 1437], ["seek", 431], ["seek", 1370]]);
  });

  it("keeps a time within the replay and a speed within the list, and says its steps under the buttons", () => {
    assert.deepEqual([within(-10, 200), within(250, 200), within(30, 200)], [0, 200, 30]);
    assert.deepEqual([nextSpeed(SPEEDS, 4, 1), nextSpeed(SPEEDS, 10, 1), nextSpeed(SPEEDS, 0.5, -1), nextSpeed(SPEEDS, 1, -1)], [10, 10, 0.5, 0.5]);
    assert.equal(replayHint({ step: "10 min", bigStep: "1 h", of: " de la garde" }), "Espace : lecture ou pause ; ← → : 10 min, avec Maj : 1 h ; ↑ ↓ : plus ou moins vite ; 0 à 9 : de 0 à 90 % de la garde");
    assert.equal(replayHint({ step: "10 tours", bigStep: "50" }), "Espace : lecture ou pause ; ← → : 10 tours, avec Maj : 50 ; ↑ ↓ : plus ou moins vite ; 0 à 9 : de 0 à 90 %");
  });
});
