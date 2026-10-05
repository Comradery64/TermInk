import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { createPanel } from "./eink";

const USE_WEBGL = false;
const INK = "rgba(28, 42, 96, 0.88)";       // fountain-pen blue
const GRAPHITE = "rgba(36, 38, 46, 0.94)";  // system text: prompt + output

/**
 * E-ink: a 4-bit greyscale panel (16 levels, as on Carta displays), lerped
 * from pigment black to the unlit page. Neither end is pure: the black
 * particles still reflect a few percent, and the white ones read as warm grey.
 */
type RGB = [number, number, number];
const EINK_PAGE: RGB = [226, 225, 219];
const EINK_INK: RGB = [22, 22, 21];
function level(n: number): RGB {
  const t = Math.max(0, Math.min(15, Math.round(n))) / 15;
  return EINK_INK.map((v, i) => Math.round(v + (EINK_PAGE[i] - v) * t)) as RGB;
}
const grey = (n: number) => `#${level(n).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
// text is never lighter than level 9, so every color stays readable
const einkFg = (r: number, g: number, b: number) => level(luma(r, g, b) * 9);
// backgrounds stay in the light half: a dark-terminal app's panel becomes a pale tint
const einkBg = (r: number, g: number, b: number) => level(11 + luma(r, g, b) * 4);
// the ANSI 16 as a typical terminal draws them, shown through the panel
const ANSI: [string, string][] = [
  ["black", "#000000"], ["red", "#cd3131"], ["green", "#0dbc79"], ["yellow", "#e5e510"],
  ["blue", "#2472c8"], ["magenta", "#bc3fbc"], ["cyan", "#11a8cd"], ["white", "#e5e5e5"],
  ["brightBlack", "#666666"], ["brightRed", "#f14c4c"], ["brightGreen", "#23d18b"], ["brightYellow", "#f5f543"],
  ["brightBlue", "#3b8eea"], ["brightMagenta", "#d670d6"], ["brightCyan", "#29b8db"], ["brightWhite", "#ffffff"],
];
/**
 * Kaleido: the same panel under a color filter array. Colors come out muted
 * (about half saturation, at the grey level's lightness) and quantized to
 * 4 bits per channel, the panel's 4096 colors.
 */
function kaleido(grey: RGB, r: number, g: number, b: number): RGB {
  const y = luma(r, g, b) * 255 || 1, k = luma(...grey) * 255 / y;
  return grey.map((v, i) => {
    const c = Math.min(255, [r, g, b][i] * k);
    return Math.round((v * 0.5 + c * 0.5) / 17) * 17;
  }) as RGB;
}
const kaleidoFg = (r: number, g: number, b: number) => kaleido(einkFg(r, g, b), r, g, b);
const kaleidoBg = (r: number, g: number, b: number) => kaleido(einkBg(r, g, b), r, g, b);
const panelAnsi = (map: (r: number, g: number, b: number) => RGB) => Object.fromEntries(ANSI.map(([k, hex]) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return [k, `rgb(${map(r, g, b).join(",")})`];
}));

type ThemeName = "paper" | "eink" | "kaleido";
const panelTheme = (map: (r: number, g: number, b: number) => RGB) => ({
  font: "Monaspace Xenon",
  lineHeight: 1.4,
  // the panel cannot blink without a refresh flicker; readers show a steady block
  cursorBlink: false,
  cursorStyle: "block" as const,
  input: level(0),              // typed commands: full black; output one level up
  theme: {
    // opaque, so SGR 7 inverse is a true black block, as on the panel
    background: grey(15),
    foreground: grey(1),
    cursor: grey(0),
    cursorAccent: grey(15),
    // selection inverts: the e-reader highlight idiom
    selectionBackground: grey(0),
    selectionForeground: grey(15),
    selectionInactiveBackground: grey(10),
    ...panelAnsi(map),
    black: grey(0),
    white: grey(9),
    brightWhite: grey(3),
  },
});
const THEMES = {
  paper: {
    font: "Monaspace Radon",
    lineHeight: 1.6,
    cursorBlink: true,
    cursorStyle: "bar" as const,
    input: [28, 42, 96] as RGB,   // typed commands: blue ink
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
  },
  eink: panelTheme(einkFg),
  kaleido: panelTheme(kaleidoFg),
};
const saved = localStorage.getItem("theme");
let themeName: ThemeName = saved === "paper" || saved === "kaleido" ? saved : "eink";
const isPanel = () => themeName !== "paper";
const T = () => THEMES[themeName];

const term = new Terminal({
  fontFamily: `"${T().font}", monospace`,
  fontSize: 15,
  lineHeight: T().lineHeight,
  allowTransparency: true,
  cursorBlink: T().cursorBlink,
  cursorStyle: T().cursorStyle,
  scrollback: 5000,
  theme: T().theme,
});

const fit = new FitAddon();
term.loadAddon(fit);
const el = document.getElementById("term")!;
const panel = createPanel(term, document.getElementById("sheet")!);

async function main() {
  setRootTheme();
  await document.fonts.load(`15px "${T().font}"`);
  term.open(el);
  panel.enable(isPanel());
  // DOM renderer on purpose: glyphs are real text, so the ink-on-paper
  // shadows are plain CSS. WebKit drops CSS filters on the WebGL canvas layer.
  if (USE_WEBGL) {
    try { term.loadAddon(new WebglAddon()); } catch (e) { console.warn("WebGL unavailable", e); }
  }
  fit.fit();
  applyRuling();

  const onData = new Channel<Uint8Array>();
  const dec = new TextDecoder();
  onData.onmessage = (bytes) => panel.write(inkify(dec.decode(new Uint8Array(bytes), { stream: true })));

  await invoke("spawn", { cols: term.cols, rows: term.rows, onData });

  // ignore keystrokes until the shell has drawn its first prompt (OSC 133;A),
  // or 2s have passed for shells without the integration
  setTimeout(() => (ready = true), 2000);
  const enc = new TextEncoder();
  term.onData((s) => { if (ready) invoke("write", { data: Array.from(enc.encode(s)) }); });
  term.onResize(({ cols, rows }) => invoke("resize", { cols, rows }));

  new ResizeObserver(() => { fit.fit(); applyRuling(); }).observe(el);
  term.attachCustomKeyEventHandler(zoomKeys);
  term.focus();
  watchTrafficLights();
}

/** macOS window buttons: hidden until the pointer is over the top strip. */
function watchTrafficLights() {
  let shown = true;
  // appear when the pointer is in the corner where the buttons live
  // (top-left on macOS), within 9% of the window's width and height
  const ZONE = 0.09;
  const set = (v: boolean) => {
    if (v === shown) return;
    shown = v;
    invoke("traffic_lights", { visible: v, duration: v ? 0.25 : 0.45 });
  };
  const inZone = (e: MouseEvent) => e.clientX <= innerWidth * ZONE && e.clientY <= innerHeight * ZONE;
  document.addEventListener("mousemove", (e) => set(inZone(e)));
  document.addEventListener("mouseleave", () => set(false));
  invoke("traffic_lights", { visible: false, duration: 0 }); shown = false;
}

const setRootTheme = () => {
  document.documentElement.dataset.theme = themeName;
  document.documentElement.toggleAttribute("data-panel", isPanel());
};

/** Switch between the paper, e-ink and Kaleido looks; persists across launches. */
async function setTheme(name: ThemeName) {
  themeName = name;
  localStorage.setItem("theme", name);
  setRootTheme();
  await document.fonts.load(`15px "${T().font}"`);
  Object.assign(term.options, {
    fontFamily: `"${T().font}", monospace`,
    lineHeight: T().lineHeight,
    cursorBlink: T().cursorBlink,
    cursorStyle: T().cursorStyle,
    theme: T().theme,
  });
  fit.fit(); applyRuling();
  panel.enable(isPanel());
  panel.fullRefresh();
}

/**
 * Cmd/Ctrl +/-/0 change font size, Cmd/Ctrl+Shift+E cycles paper -> e-ink -> Kaleido,
 * Cmd/Ctrl+Shift+L cycles the e-ink front light; everything else passes to xterm.
 */
function zoomKeys(e: KeyboardEvent): boolean {
  if (e.type !== "keydown" || !(e.metaKey || e.ctrlKey)) return true;
  if (e.shiftKey && e.code === "KeyE") {
    const order: ThemeName[] = ["paper", "eink", "kaleido"];
    setTheme(order[(order.indexOf(themeName) + 1) % order.length]);
    return false;
  }
  if (e.shiftKey && e.code === "KeyL" && isPanel()) { panel.cycleLight(); return false; }
  const step = e.key === "=" || e.key === "+" ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
  if (step === null) return true;
  term.options.fontSize = step === 0 ? 15 : Math.min(32, Math.max(9, term.options.fontSize! + step));
  fit.fit(); applyRuling();
  return false;
}

/**
 * Turn OSC 133 shell-integration marks into ink colors:
 * A (prompt start) -> system text, B (command input) -> input ink, C (output start) -> system text.
 * A sequence may be split across chunks, so hold back a trailing partial ESC.
 */
const RESET_SGR = "\x1b[39m";
let carry = "";
let ready = false;
function inkify(chunk: string): string {
  let s = carry + chunk;
  carry = "";
  const tail = s.lastIndexOf("\x1b");
  if (tail !== -1 && isPartialEscape(s.slice(tail))) {
    carry = s.slice(tail); s = s.slice(0, tail);
  }
  s = s.replace(/\x1b\]133;([ABCD])(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g, (_, m) => {
    if (m === "A") ready = true;
    return m === "B" ? `\x1b[38;2;${T().input.join(";")}m` : m === "A" || m === "C" ? RESET_SGR : "";
  });
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
 *  - 7/27 (inverse), paper only: the canvas background is transparent, so inverse
 *    would paint letters transparent and the cell in ink. Use a highlighter instead.
 *    E-ink has an opaque page, so it keeps the true inverse block.
 *  - 38;5;n and 38;2;r;g;b foregrounds: apps pick these for dark terminals;
 *    paper clamps their luminance so pale yellows/cyans stay legible,
 *    e-ink quantizes them to the panel's grey levels.
 *  - 48 backgrounds, e-ink only: quantized into the light half of the levels.
 */
const HIGHLIGHT_BG = "48;2;200;226;245";
const MAX_FG_LUMA = 0.42;
function remapSgr(seq: string, params: string): string {
  const eink = isPanel();
  if (!(eink ? /(^|;)(38|48)(;|$)/ : /(^|;)(7|27|38)(;|$)/).test(params)) return seq;
  const p = params.split(";");
  const out: string[] = [];
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    const k = themeName === "kaleido";
    const map = n === "38" ? (k ? kaleidoFg : eink ? einkFg : inkClamp) : n === "48" && eink ? (k ? kaleidoBg : einkBg) : null;
    if (map && p[i + 1] === "2" && i + 4 < p.length) {
      out.push(n, "2", ...map(+p[i + 2], +p[i + 3], +p[i + 4]).map(String)); i += 4;
    } else if (map && p[i + 1] === "5" && i + 2 < p.length) {
      const rgb = xterm256(+p[i + 2]);
      if (rgb) out.push(n, "2", ...map(...rgb).map(String)); else out.push(n, "5", p[i + 2]);
      i += 2;
    } else if ((n === "48" || n === "58") && (p[i + 1] === "2" || p[i + 1] === "5")) {
      const len = p[i + 1] === "2" ? 5 : 3;      // keep background/underline runs intact
      out.push(...p.slice(i, i + len)); i += len - 1;
    } else if (n === "7" && !eink) out.push(HIGHLIGHT_BG);
    else if (n === "27" && !eink) out.push("49");
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
  const sheet = document.getElementById("sheet")!;
  if (isPanel()) { sheet.style.paddingTop = ""; return; }
  // semi-private; isolated here so it is a one-line fix if xterm moves it
  const dims = (term as any)._core?._renderService?.dimensions?.css?.cell;
  if (!dims?.height) return;
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
