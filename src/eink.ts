import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";

/**
 * The e-ink panel: everything that makes the screen behave like electrophoretic
 * ink rather than a lit display. Deliberately exaggerated so each quirk reads
 * at normal viewing distance.
 *
 *  - output is drawn at a low panel frame rate, never per byte
 *  - each redraw flashes its changed rows inverted, then the particles settle in steps
 *  - large redraws leave ghosts; every few, or on `clear`, a full black/white flash wipes them
 *  - floods of output switch to the fast black/white (A2) waveform until they calm down
 *  - the wheel turns pages instead of scrolling
 *  - unfocused for a minute, the panel sleeps on a screensaver and holds it
 */

import type { Section, Values } from "./settings";

// a cold panel (late night) drives its particles slower and ghosts harder
const hour = new Date().getHours();
const COLD = hour < 7 || hour >= 23;
const GHOSTS_MAX = 3;
const A2_BYTES = 2500;           // a single frame this big means a flood: fast waveform

/** TermInk's own settings, shown after the shared ones. */
export const PANEL_SECTIONS: Section[] = [
  { title: "Status bar", fields: [
    { key: "status", label: "Show status bar", type: "toggle", default: true },
    { key: "brand", label: "Name", type: "toggle", default: true, parent: "status" },
    { key: "title", label: "Window title", type: "toggle", default: true, parent: "status" },
    { key: "cold", label: "Cold-panel mark", type: "toggle", default: true, parent: "status" },
    { key: "clock", label: "Clock", type: "toggle", default: true, parent: "status" },
    { key: "battery", label: "Battery", type: "toggle", default: true, parent: "status" },
  ] },
  { title: "Footer", fields: [
    { key: "footer", label: "Show footer", type: "toggle", default: false },
    { key: "page", label: "Page number", type: "toggle", default: true, parent: "footer" },
    { key: "track", label: "Progress line", type: "toggle", default: true, parent: "footer" },
    { key: "percent", label: "Percent", type: "toggle", default: true, parent: "footer" },
  ] },
  { title: "Bezel", fields: [
    { key: "bezel", label: "Bezel width", type: "range", default: 30, min: 0, max: 80, step: 2, unit: "px" },
    { key: "chin", label: "Chin", type: "toggle", default: false },
    { key: "chinSize", label: "Chin size", type: "range", default: 40, min: 8, max: 120, step: 2, unit: "px", parent: "chin" },
    { key: "wordmark", label: "Wordmark", type: "toggle", default: true },
  ] },
  { title: "Panel", fields: [
    { key: "mode", label: "Panel", type: "select", default: "eink", options: [["eink", "Carta grey"], ["kaleido", "Kaleido color"]] },
    { key: "light", label: "Front light", type: "select", default: "off", options: [["off", "Off"], ["cool", "Cool"], ["warm", "Warm"]] },
    { key: "frame", label: "Refresh interval", type: "range", default: 130, min: 16, max: 400, step: 2, unit: " ms" },
    { key: "ghost", label: "Ghosting", type: "range", default: 0.075, min: 0, max: 0.25, step: 0.005 },
    { key: "fullEvery", label: "Full refresh every", type: "range", default: 6, min: 1, max: 30, step: 1, unit: " pages" },
    { key: "sleep", label: "Sleep after unfocused", type: "range", default: 60, min: 0, max: 900, step: 15, unit: " s" },
  ] },
];

export interface Panel {
  write(s: string): void;
  enable(on: boolean): void;
  fullRefresh(): void;
  configure(v: Values): void;
  toggleSettings(): void;
}

export function createPanel(term: Terminal, sheet: HTMLElement, prefsPage: HTMLElement): Panel {
  // live config from settings; a cold panel stretches the frame and deepens ghosts
  let FRAME_MS = 130, GHOST_OPACITY = 0.075, FULL_REFRESH_EVERY = 6, SLEEP_AFTER_MS = 60_000;
  let on = false;
  let queue = "";
  let timer = 0;
  let lastFlush = 0;
  let snapshot: string | null = null;   // screen before the pending flush, for ghosting
  let large = 0;
  let a2Timer = 0;
  let sleeping = false;
  let sleepTimer = 0;

  const screen = () => sheet.querySelector<HTMLElement>(".xterm-screen")!;
  const rows = () => sheet.querySelector<HTMLElement>(".xterm-rows:not(.eink-ghost)")!;

  // ---- chrome: overlays, status bar, footer, sleep screen, bezel ----
  const mk = (id: string, parent: HTMLElement = sheet, tag = "div") => {
    const e = document.createElement(tag); e.id = id; e.className = "panel-part"; parent.append(e); return e;
  };
  mk("light"); mk("front");
  const status = mk("status");
  status.innerHTML = `<span class="brand">TermInk</span><span class="title"></span>`
    + `<span class="right"><span class="cold">${COLD ? "❄" : ""}</span><span class="clock"></span>`
    + `<span class="batt"><i></i></span><span class="pct"></span></span>`;
  const footer = mk("footer");
  footer.innerHTML = `<span class="page"></span><span class="track"><i></i></span><span class="pctr"></span>`;
  const sleep = mk("sleep");
  sleep.innerHTML = `<div class="art"></div><div class="name">TermInk</div><div class="hint">Sleeping · click to wake</div>`;
  const bezel = mk("bezel", document.body);
  bezel.setAttribute("data-tauri-drag-region", "");
  bezel.innerHTML = `<span class="mark">termink</span>`;

  // ---- settings ----
  const prefs = mk("settings");
  prefs.append(prefsPage);
  const BAR_ITEMS: [string, string][] = [
    ["brand", ".brand"], ["title", ".title"], ["cold", ".cold"], ["clock", ".clock"], ["battery", ".batt, .pct"],
    ["page", ".page"], ["track", ".track"], ["percent", ".pctr"],
  ];
  function configure(v: Values) {
    const cold = COLD ? 1.7 : 1;
    FRAME_MS = Number(v.frame) * cold;
    GHOST_OPACITY = Math.min(0.35, Number(v.ghost) * (COLD ? 1.5 : 1));
    FULL_REFRESH_EVERY = Number(v.fullEvery);
    SLEEP_AFTER_MS = Number(v.sleep) * 1000;
    sheet.classList.toggle("no-status", !v.status);
    sheet.classList.toggle("no-footer", !v.footer);
    for (const [k, sel] of BAR_ITEMS)
      sheet.querySelectorAll<HTMLElement>(sel).forEach((e) => e.classList.toggle("off", !v[k]));
    if (sheet.dataset.light !== v.light) sheet.dataset.light = String(v.light);
    const root = document.documentElement.style;
    root.setProperty("--bezel-w", `${v.bezel}px`);
    root.setProperty("--chin", v.chin ? `${v.chinSize}px` : "0px");
    bezel.classList.toggle("no-mark", !v.wordmark);
  }
  // opening and closing a menu is a full refresh on a reader
  function toggleSettings() {
    const open = !sheet.classList.contains("prefs");
    fullRefresh();
    setTimeout(() => {
      sheet.classList.toggle("prefs", open);
      open ? term.blur() : term.focus();
    }, 90);
  }
  addEventListener("keydown", (e) => {
    if (sheet.classList.contains("prefs") && (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === ","))) {
      e.preventDefault(); toggleSettings();
    }
  });

  term.onTitleChange((t) => { status.querySelector(".title")!.textContent = t; });

  // e-ink updates the clock once a minute, never more
  const tick = () => {
    const d = new Date();
    status.querySelector(".clock")!.textContent =
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };
  const battery = async () => {
    try {
      const [pct, charging] = await invoke<[number, boolean]>("battery");
      (status.querySelector(".batt i") as HTMLElement).style.width = `${pct}%`;
      status.querySelector(".batt")!.classList.toggle("charging", charging);
      status.querySelector(".pct")!.textContent = `${pct}%`;
    } catch { status.querySelector(".batt")!.remove(); }
  };
  tick(); battery();
  setTimeout(() => { tick(); setInterval(tick, 60_000); }, 60_000 - (Date.now() % 60_000));
  setInterval(battery, 120_000);

  // reading progress, Kindle-style: page N of M and percent through the scrollback
  const progress = () => {
    const b = term.buffer.active;
    const total = Math.max(term.rows, b.length);
    const pages = Math.ceil(total / term.rows);
    const page = Math.min(pages, Math.floor(b.viewportY / term.rows) + 1);
    const pct = Math.round(((b.viewportY + term.rows) / total) * 100);
    footer.querySelector(".page")!.textContent = `Page ${page} of ${pages}`;
    footer.querySelector(".pctr")!.textContent = `${pct}%`;
    (footer.querySelector(".track i") as HTMLElement).style.width = `${pct}%`;
  };
  term.onScroll(progress);
  term.onLineFeed(progress);

  // ---- drawing at the panel's frame rate ----
  function write(s: string) {
    if (!on) { term.write(s); return; }
    if (/\x1b\[[23]J|\x1bc/.test(s)) queueMicrotask(fullRefresh);   // clear = full refresh
    queue += s;
    if (!timer && !sleeping) timer = window.setTimeout(flush, Math.max(0, lastFlush + FRAME_MS - performance.now()));
  }

  function flush() {
    timer = 0;
    if (sleeping || !queue) return;
    const q = queue; queue = "";
    lastFlush = performance.now();
    snapshot = rows().innerHTML;
    flushBytes = q.length;
    if (q.length > A2_BYTES) a2(true);
    term.write(q);
  }
  let flushBytes = 0;
  let quietUntil = 0;
  // a new font size or window size reflows every line: the reader redraws the whole page
  term.onResize(() => fullRefresh());

  function a2(enter: boolean) {
    clearTimeout(a2Timer);
    if (enter) {
      sheet.classList.add("a2");
      // the flood is over once a frame passes without one: clean partial refresh
      a2Timer = window.setTimeout(() => { sheet.classList.remove("a2"); partial(0, term.rows - 1); }, FRAME_MS * 3);
    }
  }

  term.onRender(({ start, end }) => {
    if (!on) return;
    progress();
    handles();
    const snap = snapshot; snapshot = null;
    if (performance.now() < quietUntil) return;
    if (snap === null) return;              // cursor/selection repaint: the panel leaves it alone
    const n = end - start + 1;
    // Three waveforms, picked the way an e-reader's controller picks them:
    //  - DU: a keystroke or a prompt line; black/white only, drawn in place, no flash
    //  - GC partial: a few lines of output; the rows step through grey, no flash
    //  - GC flashing: most of the screen changed; inverted flash, and the old page ghosts
    if (n <= 2 && flushBytes < 160) return;
    if (n < term.rows * 0.4) { settle(start, end); return; }
    ghost(snap);
    if (++large >= FULL_REFRESH_EVERY) { fullRefresh(); return; }
    partial(start, end);
  });

  /** Step the ink in through the grey levels, without the inverted flash. */
  function settle(start: number, end: number, afterFlash = false) {
    const rs = rows().children;
    for (let i = start; i <= end; i++) rs[i]?.classList.remove("settle", "late");
    void rows().offsetWidth;
    for (let i = start; i <= end; i++) rs[i]?.classList.add("settle", ...(afterFlash ? ["late"] : []));
  }

  /** Flashing partial update: invert the changed rows for a frame, then step the ink in. */
  function partial(start: number, end: number) {
    const rs = rows().children;
    const first = rs[start] as HTMLElement | undefined, last = rs[end] as HTMLElement | undefined;
    if (!first || !last) return;
    const rect = document.createElement("div");
    rect.className = "eink-rect";
    rect.style.top = `${first.offsetTop}px`;
    rect.style.height = `${last.offsetTop + last.offsetHeight - first.offsetTop}px`;
    screen().append(rect);
    rect.addEventListener("animationend", () => rect.remove());
    settle(start, end, true);
  }

  /** The particles that did not fully flip: keep the old screen as a faint shadow. */
  function ghost(html: string) {
    const g = document.createElement("div");
    g.className = "xterm-rows eink-ghost";   // xterm-rows: inherit the renderer's font and color rules
    g.innerHTML = html;
    screen().prepend(g);
    const all = screen().querySelectorAll<HTMLElement>(".eink-ghost");
    all.forEach((e, i) => {
      if (i >= GHOSTS_MAX) e.remove();
      else e.style.opacity = String(GHOST_OPACITY * Math.pow(0.6, i));
    });
  }

  /** Full refresh: inverted image, black, white, page. Wipes every ghost. */
  function fullRefresh() {
    if (!on) return;
    large = 0;
    // the full refresh repaints everything; redraws landing right after it (the shell
    // answering a resize) are already on the page, so they must not flash again
    quietUntil = performance.now() + 450;
    screen()?.querySelectorAll(".eink-ghost").forEach((e) => e.remove());
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    sheet.classList.remove("refresh");
    void sheet.offsetWidth;
    sheet.classList.add("refresh");
  }

  // ---- pages, not scrolling ----
  let wheelAcc = 0, wheelLock = 0;
  sheet.addEventListener("wheel", (e) => {
    if (!on || term.buffer.active.type !== "normal") return;   // full-screen apps keep the wheel
    e.preventDefault(); e.stopPropagation();
    if (performance.now() < wheelLock) return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    const dir = Math.sign(wheelAcc); wheelAcc = 0;
    const b = term.buffer.active;
    if ((dir < 0 && b.viewportY === 0) || (dir > 0 && b.viewportY >= b.baseY)) return;
    wheelLock = performance.now() + 350;    // one page per flick, like a page-turn button
    snapshot = rows().innerHTML;
    term.scrollPages(dir);
  }, { capture: true, passive: false });

  // ---- selection handles ----
  const hs = [0, 1].map(() => { const h = document.createElement("div"); h.className = "eink-handle"; return h; });
  term.onSelectionChange(handles);
  function handles() {
    const pos = term.getSelectionPosition();
    const scr = screen();
    if (!scr) return;
    if (!on || !pos) { hs.forEach((h) => h.remove()); return; }
    const rs = rows().children, vp = term.buffer.active.viewportY;
    const cw = rows().clientWidth / term.cols;
    [[pos.start.x, pos.start.y], [pos.end.x, pos.end.y]].forEach(([x, y], i) => {
      const r = rs[y - vp] as HTMLElement | undefined;
      if (!r) { hs[i].remove(); return; }
      hs[i].style.left = `${x * cw}px`;
      hs[i].style.top = `${r.offsetTop}px`;
      hs[i].style.height = `${r.offsetHeight}px`;
      hs[i].classList.toggle("end", i === 1);
      scr.append(hs[i]);
    });
  }

  // ---- sleep: the panel holds its last image without power ----
  addEventListener("blur", () => {
    clearTimeout(sleepTimer);
    if (!SLEEP_AFTER_MS) return;          // sleep set to 0: never
    sleepTimer = window.setTimeout(() => {
      if (!on) return;
      fullRefresh();
      setTimeout(() => { sleeping = true; sheet.classList.add("sleeping"); }, 160);
    }, SLEEP_AFTER_MS);
  });
  const wake = () => {
    clearTimeout(sleepTimer);
    if (!sleeping) return;
    sleeping = false;
    sheet.classList.remove("sleeping");
    fullRefresh();
    flush();
  };
  addEventListener("focus", wake);
  sleep.addEventListener("mousedown", wake);

  // ---- SVG filters: eaten ink edges, and the hard two-level A2 waveform ----
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML = `
    <filter id="eink-fuzz" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="eink-a2">
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncR type="discrete" tableValues="0 0 1"/><feFuncG type="discrete" tableValues="0 0 1"/>
        <feFuncB type="discrete" tableValues="0 0 1"/><feFuncA type="discrete" tableValues="0 1 1"/>
      </feComponentTransfer>
    </filter>`;
  document.body.append(svg);

  function enable(v: boolean) {
    on = v;
    if (!v) {
      clearTimeout(timer); timer = 0;
      if (queue) { term.write(queue); queue = ""; }
      sheet.classList.remove("a2", "sleeping", "refresh");
      sleeping = false;
      screen()?.querySelectorAll(".eink-ghost, .eink-rect").forEach((e) => e.remove());
      hs.forEach((h) => h.remove());
    } else progress();
  }

  return { write, enable, fullRefresh, configure, toggleSettings };
}
