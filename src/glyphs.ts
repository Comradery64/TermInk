import type { Terminal } from "@xterm/xterm";

/**
 * Block elements (U+2580–259F) and box drawing (U+2500–257F) drawn as geometry
 * instead of font glyphs. With line spacing above 1 a font's block never reaches
 * the next row, and most fonts lack the quadrants, so logos made of them (Claude
 * Code's) break apart. Each such character becomes a cell-sized box filled with
 * rectangles in the text's own color, spanning the full row height so rows join.
 *
 * xterm's own customGlyphs does this only in the canvas/WebGL renderers; this is
 * the DOM-renderer equivalent, applied to rows right after xterm paints them.
 */

type Rect = [number, number, number, number];   // x, y, w, h as fractions of the cell
const H = (y: number, h: number): Rect => [0, y, 1, h];
const V = (x: number, w: number): Rect => [x, 0, w, 1];
const Q = { tl: [0, 0, 0.5, 0.5], tr: [0.5, 0, 0.5, 0.5], bl: [0, 0.5, 0.5, 0.5], br: [0.5, 0.5, 0.5, 0.5] } as Record<string, Rect>;

const BLOCKS: Record<string, Rect[]> = {
  "▀": [H(0, 0.5)], "▄": [H(0.5, 0.5)], "█": [H(0, 1)], "▌": [V(0, 0.5)], "▐": [V(0.5, 0.5)],
  "▁": [H(7 / 8, 1 / 8)], "▂": [H(6 / 8, 2 / 8)], "▃": [H(5 / 8, 3 / 8)], "▅": [H(3 / 8, 5 / 8)],
  "▆": [H(2 / 8, 6 / 8)], "▇": [H(1 / 8, 7 / 8)], "▔": [H(0, 1 / 8)],
  "▉": [V(0, 7 / 8)], "▊": [V(0, 6 / 8)], "▋": [V(0, 5 / 8)], "▍": [V(0, 3 / 8)], "▎": [V(0, 2 / 8)],
  "▏": [V(0, 1 / 8)], "▕": [V(7 / 8, 1 / 8)],
  "▖": [Q.bl], "▗": [Q.br], "▘": [Q.tl], "▝": [Q.tr],
  "▙": [Q.tl, Q.bl, Q.br], "▚": [Q.tl, Q.br], "▛": [Q.tl, Q.tr, Q.bl], "▜": [Q.tl, Q.tr, Q.br],
  "▞": [Q.tr, Q.bl], "▟": [Q.tr, Q.bl, Q.br],
};
const SHADES: Record<string, number> = { "░": 0.25, "▒": 0.5, "▓": 0.75 };

// box drawing: which arms leave the center (up, right, down, left); heavy/double drawn thicker
const ARMS: Record<string, string> = {
  "─": "rl", "━": "rl", "│": "ud", "┃": "ud", "═": "rl", "║": "ud",
  "┌": "rd", "┐": "ld", "└": "ur", "┘": "ul", "╭": "rd", "╮": "ld", "╰": "ur", "╯": "ul",
  "┏": "rd", "┓": "ld", "┗": "ur", "┛": "ul", "╔": "rd", "╗": "ld", "╚": "ur", "╝": "ul",
  "├": "udr", "┤": "udl", "┬": "rld", "┴": "rlu", "┼": "udrl",
  "┣": "udr", "┫": "udl", "┳": "rld", "┻": "rlu", "╋": "udrl",
  "╠": "udr", "╣": "udl", "╦": "rld", "╩": "rlu", "╬": "udrl",
  "╴": "l", "╵": "u", "╶": "r", "╷": "d",
};
const HEAVY = /[━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬]/;
const DRAWN = /[─-▟]/;

/** CSS background layers for one character, or null if we leave it to the font. */
function paint(ch: string): string | null {
  const fill = (r: Rect, a = 1) => {
    const c = a === 1 ? "currentColor" : `color-mix(in srgb, currentColor ${a * 100}%, transparent)`;
    return `linear-gradient(${c},${c}) ${r[0] * 100}% ${r[1] * 100}% / ${r[2] * 100}% ${r[3] * 100}% no-repeat`;
  };
  if (BLOCKS[ch]) return BLOCKS[ch].map((r) => fill(fixPos(r))).join(",");
  if (SHADES[ch]) return fill([0, 0, 1, 1], SHADES[ch]);
  const arms = ARMS[ch];
  if (!arms) return null;
  // stroke width in cell fractions is set in CSS via --stroke; positions use calc
  const t = HEAVY.test(ch) ? "var(--stroke-heavy)" : "var(--stroke)";
  const layers: string[] = [];
  const c = "linear-gradient(currentColor,currentColor)";
  if (arms.includes("l")) layers.push(`${c} 0 50% / calc(50% + ${t} / 2) ${t} no-repeat`);
  if (arms.includes("r")) layers.push(`${c} 100% 50% / calc(50% + ${t} / 2) ${t} no-repeat`);
  if (arms.includes("u")) layers.push(`${c} 50% 0 / ${t} calc(50% + ${t} / 2) no-repeat`);
  if (arms.includes("d")) layers.push(`${c} 50% 100% / ${t} calc(50% + ${t} / 2) no-repeat`);
  return layers.join(",");
}

/** background-position % is relative to (cell - layer), so convert a rect's x/y to that space. */
function fixPos([x, y, w, h]: Rect): Rect {
  return [w === 1 ? 0 : x / (1 - w), h === 1 ? 0 : y / (1 - h), w, h];
}

const cache = new Map<string, string | null>();
const style = (ch: string) => { if (!cache.has(ch)) cache.set(ch, paint(ch)); return cache.get(ch)!; };

function redraw(row: HTMLElement) {
  if (!DRAWN.test(row.textContent ?? "")) return;
  for (const node of Array.from(row.childNodes)) {
    const text = node.textContent ?? "";
    if (!DRAWN.test(text)) continue;
    const span = node.nodeType === Node.TEXT_NODE ? null : (node as HTMLElement);
    const frag = document.createDocumentFragment();
    let run = "";
    const flush = () => {
      if (!run) return;
      const s = span ? (span.cloneNode(false) as HTMLElement) : document.createElement("span");
      s.textContent = run; frag.append(s); run = "";
    };
    for (const ch of text) {
      const bg = DRAWN.test(ch) ? style(ch) : null;
      if (!bg) { run += ch; continue; }
      flush();
      const s = span ? (span.cloneNode(false) as HTMLElement) : document.createElement("span");
      s.classList.add("glyph");
      s.style.background = bg;
      frag.append(s);
    }
    flush();
    node.replaceWith(frag);
  }
}

export function drawGlyphs(term: Terminal, sheet: HTMLElement) {
  term.onRender(({ start, end }) => {
    const rows = sheet.querySelector<HTMLElement>(".xterm-rows:not(.eink-ghost)");
    if (!rows) return;
    // exact cell width from xterm (semi-private, isolated here); glyph boxes are sized to it
    const cw = (term as any)._core?._renderService?.dimensions?.css?.cell?.width ?? rows.clientWidth / term.cols;
    rows.parentElement!.style.setProperty("--cw", `${cw}px`);   // on the screen, so ghosts inherit it
    for (let i = start; i <= end; i++) {
      const r = rows.children[i] as HTMLElement | undefined;
      if (r) redraw(r);
    }
  });
}
