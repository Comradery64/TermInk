import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import "./fonts.css";
import { createPanel, PANEL_SECTIONS } from "./eink";
import { createSettings, CORE, type Section, type Values } from "./settings";
import { createSyntax, TOKENS, type Token } from "./syntax";
import { createGutter } from "./gutter";


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


type Mode = "eink" | "kaleido";
const panelTheme = (map: (r: number, g: number, b: number) => RGB) => ({
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
});
const THEMES = { eink: panelTheme(einkFg), kaleido: panelTheme(kaleidoFg) };
const INPUT_SGR = `\x1b[38;2;${level(0).join(";")}m`;   // typed commands: full black; output one level up
const CODE: Section[] = [
  { title: "Line numbers", fields: [
    { key: "lineNumbers", label: "Line numbers", type: "select", default: "off",
      options: [["off", "Off"], ["absolute", "Absolute"], ["relative", "Relative"]] },
  ] },
  { title: "Syntax highlighting", fields: [
    { key: "hlCommands", label: "Typed commands", type: "toggle", default: true },
    { key: "hlOutput", label: "Command output", type: "toggle", default: true },
    ...TOKENS.map(([t, label, color]) => ({ key: `color.${t}`, label, type: "color" as const, default: color })),
  ] },
];
const settings = createSettings([...CORE, ...CODE, ...PANEL_SECTIONS], "termink.settings.v2", apply);
const S = settings.values;

const term = new Terminal({
  fontFamily: `"${S.font}", monospace`,
  fontSize: Number(S.fontSize),
  lineHeight: Number(S.lineHeight),
  allowTransparency: true,
  // the panel cannot blink without a refresh flicker; readers show a steady cursor
  cursorBlink: false,
  cursorStyle: S.cursor as "block" | "bar" | "underline",
  macOptionIsMeta: !!S.optionMeta,
  scrollback: Number(S.scrollback),
  theme: THEMES[S.mode as Mode],
});

const fit = new FitAddon();
term.loadAddon(fit);
const el = document.getElementById("term")!;
const panel = createPanel(term, document.getElementById("sheet")!, settings.el);

const gutter = createGutter(term, document.getElementById("sheet")!);
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
// token colors are raw here; remapSgr then puts them through the panel like any app color
const highlight = createSyntax(() => ({
  commands: !!S.hlCommands,
  output: !!S.hlOutput,
  color: (t: Token) => hex(String(S[`color.${t}`])),
  inputSgr: INPUT_SGR,
}));

/** Push settings into xterm, the page layout and the panel engine. */
function apply(v: Values, key?: string) {
  if (key === "font") {
    // wait for the face before measuring, or the cell grid is sized for the fallback
    document.fonts.load(`15px "${v.font}"`).then(() => {
      term.options.fontFamily = `"${v.font}", monospace`;
      fit.fit(); panel.fullRefresh();
    });
  }
  const reflow = !key || ["fontSize", "lineHeight", "margin", "bezel", "chin", "chinSize", "status", "footer", "lineNumbers"].includes(key);
  Object.assign(term.options, {
    fontSize: Number(v.fontSize),
    lineHeight: Number(v.lineHeight),
    cursorStyle: v.cursor,
    macOptionIsMeta: !!v.optionMeta,
    scrollback: Number(v.scrollback),
    theme: THEMES[v.mode as Mode],
  });
  document.documentElement.dataset.mode = String(v.mode);
  document.documentElement.style.setProperty("--m", `${v.margin}px`);
  panel.configure(v);
  gutter.setMode(String(v.lineNumbers));
  if (reflow || key === "lineNumbers") document.documentElement.style.setProperty("--gw", v.lineNumbers === "off" ? "0px" : "4.2em");
  if (reflow && term.element) fit.fit();
  if (key === "mode" || key === "light") panel.fullRefresh();
}


async function main() {
  apply(S);
  // a missing font must never stop the shell: fall back and carry on
  await document.fonts.load(`15px "${S.font}"`).catch((e) => console.warn("font load failed", e));
  // DOM renderer on purpose: glyphs are real text, so the panel's grain,
  // ghosts and refresh flashes are plain CSS over them.
  term.open(el);
  panel.enable(true);
  fit.fit();

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

  new ResizeObserver(() => fit.fit()).observe(el);
  term.attachCustomKeyEventHandler(keys);
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

/**
 * Cmd/Ctrl +/-/0 change font size (saved to settings), Cmd/Ctrl+Shift+K toggles
 * Kaleido color, Cmd/Ctrl+Shift+L cycles the front light, Cmd/Ctrl+, opens
 * settings; everything else passes to xterm.
 */
function keys(e: KeyboardEvent): boolean {
  if (e.type !== "keydown" || !(e.metaKey || e.ctrlKey)) return true;
  const cycle = (k: string, order: string[]) => settings.set(k, order[(order.indexOf(String(S[k])) + 1) % order.length]);
  if (e.shiftKey && e.code === "KeyK") { cycle("mode", ["eink", "kaleido"]); return false; }
  if (e.shiftKey && e.code === "KeyL") { cycle("light", ["off", "cool", "warm"]); return false; }
  if (!e.shiftKey && e.key === ",") { panel.toggleSettings(); return false; }
  const step = e.key === "=" || e.key === "+" ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
  if (step === null) return true;
  settings.set("fontSize", step === 0 ? 15 : Math.min(32, Math.max(9, Number(S.fontSize) + step)));
  panel.fullRefresh();     // zoom reflows the whole page, history included
  return false;
}

/**
 * Turn OSC 133 shell-integration marks into ink levels:
 * A (prompt start) -> system text, B (command input) -> full black, C (output start) -> system text.
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
    return m === "B" ? INPUT_SGR : m === "A" || m === "C" ? RESET_SGR : "";
  });
  return highlight(s).replace(/\x1b\[([0-9;]*)m/g, remapSgr);
}

/** True only for an escape sequence that is genuinely cut off at the chunk end. */
function isPartialEscape(t: string): boolean {
  if (t.length === 1) return true;                                  // lone ESC
  if (t[1] === "]") return !/[\x07\x9c]|\x1b\\/.test(t) && t.length < 64;  // OSC without terminator
  if (t[1] === "[") return !/[\x40-\x7e]/.test(t.slice(2));         // CSI without final byte
  return false;                                                     // anything else: pass through
}

/**
 * Rewrite 256-color and truecolor SGR for the panel: apps pick these for dark
 * terminals, so foregrounds are quantized to the dark grey levels and
 * backgrounds into the light half. Underline colors (58) pass through.
 */
function remapSgr(seq: string, params: string): string {
  if (!/(^|;)(38|48)(;|$)/.test(params)) return seq;
  const k = S.mode === "kaleido";
  const p = params.split(";");
  const out: string[] = [];
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    const map = n === "38" ? (k ? kaleidoFg : einkFg) : n === "48" ? (k ? kaleidoBg : einkBg) : null;
    if (map && p[i + 1] === "2" && i + 4 < p.length) {
      out.push(n, "2", ...map(+p[i + 2], +p[i + 3], +p[i + 4]).map(String)); i += 4;
    } else if (map && p[i + 1] === "5" && i + 2 < p.length) {
      const rgb = xterm256(+p[i + 2]);
      if (rgb) out.push(n, "2", ...map(...rgb).map(String)); else out.push(n, "5", p[i + 2]);
      i += 2;
    } else if (n === "58" && (p[i + 1] === "2" || p[i + 1] === "5")) {
      const len = p[i + 1] === "2" ? 5 : 3;      // keep underline-color runs intact
      out.push(...p.slice(i, i + len)); i += len - 1;
    } else out.push(n);
  }
  return `\x1b[${out.join(";")}m`;
}

/** RGB for xterm 256-color indices 16..255; null for 0..15 (theme handles those). */
function xterm256(n: number): RGB | null {
  if (n < 16 || n > 255 || Number.isNaN(n)) return null;
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v]; }
  const c = n - 16, lv = [0, 95, 135, 175, 215, 255];
  return [lv[Math.floor(c / 36)], lv[Math.floor(c / 6) % 6], lv[c % 6]];
}

main();
