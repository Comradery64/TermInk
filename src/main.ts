import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

const USE_WEBGL = false;
const INK = "rgba(28, 42, 96, 0.88)";       // fountain-pen blue
const GRAPHITE = "rgba(40, 40, 48, 0.82)";

const term = new Terminal({
  fontFamily: '"Monaspace Radon", monospace',
  fontSize: 15,
  lineHeight: 1.6,
  allowTransparency: true,
  cursorBlink: true,
  cursorStyle: "bar",
  scrollback: 5000,
  theme: {
    background: "rgba(0,0,0,0)",
    foreground: GRAPHITE,
    cursor: INK,
    selectionBackground: "#c8e2f5",
    selectionInactiveBackground: "#dde9f3",
    // ink palette for a light page: every color dark enough to read on paper
    black: GRAPHITE,        brightBlack: "#5a5e6a",
    red: "#b3261e",         brightRed: "#c62828",
    green: "#2e7d32",       brightGreen: "#1b7f3b",
    yellow: "#8a6d00",      brightYellow: "#946f00",
    blue: INK,              brightBlue: INK,
    magenta: "#7b3f8c",     brightMagenta: "#8e3f9e",
    cyan: "#0e6e7c",        brightCyan: "#0f7f90",
    white: "#6b6f7b",       brightWhite: "#3a3d47",
  },
});

const fit = new FitAddon();
term.loadAddon(fit);
const el = document.getElementById("term")!;

async function main() {
  await document.fonts.load('15px "Monaspace Radon"');
  term.open(el);
  // DOM renderer on purpose: glyphs are real text, so the ink-on-paper
  // shadows are plain CSS. WebKit drops CSS filters on the WebGL canvas layer.
  if (USE_WEBGL) {
    try { term.loadAddon(new WebglAddon()); } catch (e) { console.warn("WebGL unavailable", e); }
  }
  fit.fit();
  applyRuling();

  const onData = new Channel<Uint8Array>();
  const dec = new TextDecoder();
  onData.onmessage = (bytes) => term.write(inkify(dec.decode(new Uint8Array(bytes), { stream: true })));

  await invoke("spawn", { cols: term.cols, rows: term.rows, onData });

  const enc = new TextEncoder();
  term.onData((s) => invoke("write", { data: Array.from(enc.encode(s)) }));
  term.onResize(({ cols, rows }) => invoke("resize", { cols, rows }));

  new ResizeObserver(() => { fit.fit(); applyRuling(); }).observe(el);
  term.attachCustomKeyEventHandler(zoomKeys);
  term.focus();
}

/** Cmd/Ctrl +/-/0 change font size; everything else passes to xterm. */
function zoomKeys(e: KeyboardEvent): boolean {
  if (e.type !== "keydown" || !(e.metaKey || e.ctrlKey)) return true;
  const step = e.key === "=" || e.key === "+" ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
  if (step === null) return true;
  term.options.fontSize = step === 0 ? 15 : Math.min(32, Math.max(9, term.options.fontSize! + step));
  fit.fit(); applyRuling();
  return false;
}

/**
 * Turn OSC 133 shell-integration marks into ink colors:
 * A (prompt start) -> blue ink, C (output start) -> graphite.
 * A sequence may be split across chunks, so hold back a trailing partial ESC.
 */
const INK_SGR = "\x1b[38;2;28;42;96m";
const RESET_SGR = "\x1b[39m";
let carry = "";
function inkify(chunk: string): string {
  let s = carry + chunk;
  carry = "";
  const tail = s.lastIndexOf("\x1b");
  if (tail !== -1 && isPartialEscape(s.slice(tail))) {
    carry = s.slice(tail); s = s.slice(0, tail);
  }
  s = s.replace(/\x1b\]133;([ABCD])(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g, (_, m) =>
    m === "A" ? INK_SGR : m === "C" ? RESET_SGR : "");
  return s.replace(/\x1b\[([0-9;]*)m/g, remapSgr);
}

/** True only for an escape sequence that is genuinely cut off at the chunk end. */
function isPartialEscape(t: string): boolean {
  if (t.length === 1) return true;                                  // lone ESC
  if (t[1] === "]") return !/[\x07\x9c]|\x1b\\/.test(t) && t.length < 64;  // OSC without terminator
  if (t[1] === "[") return !/[\x40-\x7e]/.test(t.slice(2));         // CSI without final byte
  return false;                                                     // anything else: pass through
}

/**
 * Rewrite SGR sequences for a light page:
 *  - 7/27 (inverse): the canvas background is transparent, so inverse would
 *    paint letters transparent and the cell in ink. Use a highlighter instead.
 *  - 38;5;n and 38;2;r;g;b foregrounds: apps pick these for dark terminals;
 *    clamp their luminance so pale yellows/cyans stay legible on paper.
 */
const HIGHLIGHT_BG = "48;2;200;226;245";
const MAX_FG_LUMA = 0.42;
function remapSgr(seq: string, params: string): string {
  if (!/(^|;)(7|27|38)(;|$)/.test(params)) return seq;
  const p = params.split(";");
  const out: string[] = [];
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    if (n === "38" && p[i + 1] === "2" && i + 4 < p.length) {
      out.push("38", "2", ...inkClamp(+p[i + 2], +p[i + 3], +p[i + 4]).map(String)); i += 4;
    } else if (n === "38" && p[i + 1] === "5" && i + 2 < p.length) {
      const rgb = xterm256(+p[i + 2]);
      if (rgb) out.push("38", "2", ...inkClamp(...rgb).map(String)); else out.push("38", "5", p[i + 2]);
      i += 2;
    } else if ((n === "48" || n === "58") && (p[i + 1] === "2" || p[i + 1] === "5")) {
      const len = p[i + 1] === "2" ? 5 : 3;      // keep background/underline runs intact
      out.push(...p.slice(i, i + len)); i += len - 1;
    } else if (n === "7") out.push(HIGHLIGHT_BG);
    else if (n === "27") out.push("49");
    else out.push(n);
  }
  return `\x1b[${out.join(";")}m`;
}

/** Darken an RGB foreground until its luminance is at most MAX_FG_LUMA. */
function inkClamp(r: number, g: number, b: number): [number, number, number] {
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luma <= MAX_FG_LUMA) return [r, g, b];
  const k = MAX_FG_LUMA / luma;
  return [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
}

/** RGB for xterm 256-color indices 16..255; null for 0..15 (theme handles those). */
function xterm256(n: number): [number, number, number] | null {
  if (n < 16 || n > 255 || Number.isNaN(n)) return null;
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v]; }
  const c = n - 16, lv = [0, 95, 135, 175, 215, 255];
  return [lv[Math.floor(c / 36)], lv[Math.floor(c / 6) % 6], lv[c % 6]];
}

/** Lock the paper ruling to xterm's actual cell height. */
function applyRuling() {
  // semi-private; isolated here so it is a one-line fix if xterm moves it
  const dims = (term as any)._core?._renderService?.dimensions?.css?.cell;
  if (!dims?.height) return;
  const sheet = document.getElementById("sheet")!;
  // whole pixels only: a half-pixel offset anti-aliases the 1px rules to grey
  const cell = Math.round(dims.height);
  // 1.5 rows of space above the text; the header strip hides the top rule,
  // so the first visible rule is the one under the single empty line.
  sheet.style.paddingTop = `${Math.round(cell * 1.5)}px`;
  sheet.style.setProperty("--cover", `${cell}px`);
  const top = Math.round(el.getBoundingClientRect().top - sheet.getBoundingClientRect().top);
  sheet.style.setProperty("--rule", `${cell}px`);
  sheet.style.setProperty("--rule-offset", `${top + cell - 1}px`);
}

main();
