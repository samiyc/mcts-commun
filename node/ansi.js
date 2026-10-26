/**
 * Terminal colour codes (`ESC [ … letter`), read without a regular expression (no control character in one): the
 * visible part of a coloured text, and a text cut or padded on its visible characters. For `--list` and the
 * terminal view (node/tui.js).
 */
export const ESC = "\u001b";
export const CSI = `${ESC}[`;
export const RESET = `${CSI}0m`;
export const INVERSE = `${CSI}7m`;
const PARAMETERS = "0123456789;?";

/** The length of the colour code at `i` in `text`, 0 when there is none. */
function codeAt(text, i) {
  if (!text.startsWith(CSI, i)) return 0;
  let end = i + CSI.length;
  while (end < text.length && PARAMETERS.includes(text[end])) end += 1;
  return /[A-Za-z]/.test(text[end] ?? "") ? end + 1 - i : 0;
}

/** `text` as its colour codes and its visible runs, in order: `[{ code, text }]`. */
export function ansiParts(text) {
  const parts = [];
  let plain = "";
  for (let i = 0; i < text.length; ) {
    const length = codeAt(text, i);
    if (length === 0) {
      plain += text[i];
      i += 1;
      continue;
    }
    if (plain) parts.push({ code: false, text: plain });
    plain = "";
    parts.push({ code: true, text: text.slice(i, i + length) });
    i += length;
  }
  if (plain) parts.push({ code: false, text: plain });
  return parts;
}

/** What a terminal shows of `text`: its colour codes taken out. */
export const visible = (text) =>
  ansiParts(String(text))
    .filter((part) => !part.code)
    .map((part) => part.text)
    .join("");

/** `text` (colour codes allowed) cut or padded to `width` visible characters. */
export function clip(text, width) {
  let out = "";
  let shown = 0;
  for (const part of ansiParts(String(text))) {
    const room = width - shown;
    if (part.code) out += part.text;
    if (part.code || room <= 0) continue;
    const kept = part.text.length > room ? part.text.slice(0, Math.max(0, room - 1)) + "…" : part.text;
    out += kept;
    shown += kept.length;
  }
  const reset = out.includes(CSI) ? RESET : "";
  return out + reset + " ".repeat(Math.max(0, width - shown));
}
