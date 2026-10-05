import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

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
    selectionBackground: "rgba(28, 42, 96, 0.18)",
    blue: INK,
    brightBlue: INK,
    red: "rgba(190, 50, 40, 0.9)",
    green: "rgba(40, 110, 60, 0.9)",
    yellow: "rgba(160, 120, 20, 0.9)",
    magenta: "rgba(120, 40, 120, 0.9)",
    cyan: "rgba(20, 110, 130, 0.9)",
    black: GRAPHITE,
    white: "rgba(90, 90, 100, 0.7)",
  },
});

const fit = new FitAddon();
term.loadAddon(fit);
const el = document.getElementById("term")!;

async function main() {
  await document.fonts.load('15px "Monaspace Radon"');
  term.open(el);
  try {
    term.loadAddon(new WebglAddon());
  } catch (e) {
    console.warn("WebGL unavailable, using DOM renderer", e);
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
  if (tail !== -1 && tail > s.length - 8 && !/[\x07\x9c]|\x1b\\/.test(s.slice(tail))) {
    carry = s.slice(tail); s = s.slice(0, tail);
  }
  s = s.replace(/\x1b\]133;([ABCD])(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g, (_, m) =>
    m === "A" ? INK_SGR : m === "C" ? RESET_SGR : "");
  return s.replace(/\x1b\[([0-9;]*)m/g, remapInverse);
}

/**
 * The canvas background is transparent, so SGR 7 (inverse) would paint text
 * in "transparent" and the cell in ink: a dark bar with no letters (zsh paste
 * highlight, grep --color, less). Replace 7 with a highlighter background.
 */
const HIGHLIGHT_BG = "48;2;200;226;245";
function remapInverse(seq: string, params: string): string {
  if (!/(^|;)(7|27)(;|$)/.test(params)) return seq;
  const p = params.split(";");
  const out: string[] = [];
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    if ((n === "38" || n === "48" || n === "58") && (p[i + 1] === "2" || p[i + 1] === "5")) {
      const len = p[i + 1] === "2" ? 5 : 3;      // keep extended color runs intact
      out.push(...p.slice(i, i + len)); i += len - 1;
    } else if (n === "7") out.push(HIGHLIGHT_BG);
    else if (n === "27") out.push("49");
    else out.push(n);
  }
  return `\x1b[${out.join(";")}m`;
}

/** Lock the paper ruling to xterm's actual cell height. */
function applyRuling() {
  // semi-private; isolated here so it is a one-line fix if xterm moves it
  const dims = (term as any)._core?._renderService?.dimensions?.css?.cell;
  if (!dims?.height) return;
  const sheet = document.getElementById("sheet")!;
  const top = el.getBoundingClientRect().top - sheet.getBoundingClientRect().top;
  sheet.style.setProperty("--rule", `${dims.height}px`);
  sheet.style.setProperty("--rule-offset", `${top + dims.height - 1}px`);
}

main();
