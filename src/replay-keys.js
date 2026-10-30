/**
 * The keys of a replay, as on a video (Sami, 29/10/2026; three copies made one: mcts-urgences' web/replay-keys.js,
 * mcts-entrepot's, mcts-cuisine's web/player-keys.js, whose rule for buttons this one keeps): space plays or pauses;
 * the left and right arrows go a step back or on, a big step with Shift; the up and down arrows play faster or slower;
 * 0 to 9, on the keypad or the row of figures, go to 0 %, 10 %… 90 % of the replay.
 *
 * It knows no unit: a project gives its steps in its replay's (minutes, turns, hours, days). Nor any game: while a
 * character is played at the keyboard (ZQSD and E), the page calls it not at all (Sami, 29/10/2026: "en mode jeu, on
 * n'est plus en mode lecture").
 *
 * `player`: `{ t(), end(), seek(t), toggle(), faster(way) }`, where the replay stands, its end, and what the keys do;
 * what `seek` returns (a promise, at the kitchen) is left alone.
 */

/**
 * Whether a key may go to the replay: no modifier but Shift, not in a field (an arrow moves its value); on a button,
 * space presses the button, the other keys go to the replay.
 */
function forTheReplay(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  const target = /** @type {HTMLElement} */ (event.target);
  // A key sent to the document itself has no closest (entrepot, 30/10/2026).
  if (target.closest?.("input, textarea, select")) return false;
  return !(event.key === " " && target.closest?.("button"));
}

/**
 * The tenth a key goes to: its figure, else the figure of its place on the row (an AZERTY keyboard) or on the keypad
 * (num lock off, but for its arrows, read first); null for another key.
 */
function tenthOf(event) {
  const figure = /^\d$/.test(event.key) ? event.key : (/^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1] ?? null);
  return figure === null ? null : Number(figure);
}

/** The time `t` kept within the replay, from its start to `end`. */
export const within = (t, end) => Math.max(0, Math.min(end, t));

/** The speed after `current` in `speeds` (`[[value, label]]`, slowest first), faster (`way` 1) or slower (-1). */
export function nextSpeed(speeds, current, way) {
  const at = speeds.findIndex(([value]) => Number(value) === current);
  return Number(speeds[Math.max(0, Math.min(speeds.length - 1, at + way))][0]);
}

// The arrows: back or on in time, faster or slower.
const MOVES = { ArrowLeft: -1, ArrowRight: 1 };
const SPEEDS = { ArrowUp: 1, ArrowDown: -1 };

/** What a key does to the replay, or null if it is not the replay's: the arrows before the figures (the keypad's). */
function moveOf({ step, bigStep, whole }, player, event) {
  const go = (t) => player.seek(within(whole ? Math.round(t) : t, player.end()));
  const { key } = event;
  if (key === " ") return () => player.toggle();
  if (Object.hasOwn(MOVES, key)) return () => go(player.t() + MOVES[key] * (event.shiftKey ? bigStep : step));
  if (Object.hasOwn(SPEEDS, key)) return () => player.faster(SPEEDS[key]);
  const tenth = tenthOf(event);
  return tenth === null ? null : () => go((player.end() * tenth) / 10);
}

/**
 * The keys of a replay that moves by `step`, `bigStep` with Shift, in its own unit; `whole`: to whole turns. Returns
 * `(player, event) => boolean`, for the page's keydown (true: the key was the replay's, its default prevented).
 *
 * @param {{ step: number, bigStep: number, whole?: boolean }} steps
 */
export function replayKeys({ step, bigStep, whole = false }) {
  const steps = { step, bigStep, whole };
  return (player, event) => {
    const move = forTheReplay(event) ? moveOf(steps, player, event) : null;
    if (!move) return false;
    event.preventDefault();
    move();
    return true;
  };
}

/**
 * The line of help under a replay's buttons, its steps said by the project ("10 min", "1 h"; "10 tours", "50") and
 * `of` what the tenths are of (" de la garde").
 *
 * @param {{ step: string, bigStep: string, of?: string }} said
 */
export const replayHint = ({ step, bigStep, of = "" }) => `Espace : lecture ou pause ; ← → : ${step}, avec Maj : ${bigStep} ; ↑ ↓ : plus ou moins vite ; 0 à 9 : de 0 à 90 %${of}`;
