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
  onData.onmessage = (bytes) => term.write(dec.decode(new Uint8Array(bytes), { stream: true }));

  await invoke("spawn", { cols: term.cols, rows: term.rows, onData });

  const enc = new TextEncoder();
  term.onData((s) => invoke("write", { data: Array.from(enc.encode(s)) }));
  term.onResize(({ cols, rows }) => invoke("resize", { cols, rows }));

  new ResizeObserver(() => { fit.fit(); applyRuling(); }).observe(el);
  term.focus();
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
