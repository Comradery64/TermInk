import type { Terminal } from "@xterm/xterm";

/**
 * Line numbers in the left margin. Counts logical lines: a line that soft-wrapped
 * onto the next row gets one number, its continuation rows stay blank. Rows below
 * the cursor (not written yet) and full-screen apps get none.
 * Modes: "absolute", or "relative" (distance from the cursor line, like vim's).
 */
export function createGutter(term: Terminal, sheet: HTMLElement) {
  const g = document.createElement("div");
  g.id = "gutter";
  let mode = "off";

  function render() {
    const screen = sheet.querySelector<HTMLElement>(".xterm-screen");
    const rows = sheet.querySelector<HTMLElement>(".xterm-rows:not(.eink-ghost)");
    const b = term.buffer.active;
    const on = mode !== "off" && b.type === "normal" && !!screen && !!rows;
    sheet.classList.toggle("numbered", on);
    if (!on) { g.remove(); return; }
    if (g.parentElement !== screen) screen!.append(g);

    // logical number of the first visible row: count unwrapped lines above it
    let n = 0;
    for (let y = 0; y <= b.viewportY; y++) if (!b.getLine(y)?.isWrapped) n++;
    const cursor = b.baseY + b.cursorY;
    let cursorN = n;
    for (let y = b.viewportY + 1; y <= cursor; y++) if (!b.getLine(y)?.isWrapped) cursorN++;
    if (cursor < b.viewportY) cursorN = -1;

    let html = "";
    const els = rows!.children;
    for (let i = 0; i < els.length; i++) {
      const y = b.viewportY + i;
      if (i > 0 && !b.getLine(y)?.isWrapped) n++;
      const el = els[i] as HTMLElement;
      const wrapped = b.getLine(y)?.isWrapped;
      const label = y > cursor || wrapped ? "" : mode === "relative" && n !== cursorN ? String(Math.abs(n - cursorN)) : String(n);
      html += `<div class="${y === cursor ? "cur" : ""}" style="top:${el.offsetTop}px;height:${el.offsetHeight}px;line-height:${el.offsetHeight}px">${label}</div>`;
    }
    g.innerHTML = html;
    g.style.fontFamily = term.options.fontFamily!;
    g.style.fontSize = `${Math.round(term.options.fontSize! * 0.8)}px`;
  }

  term.onRender(render);
  term.onScroll(render);
  term.onCursorMove(render);
  return {
    setMode(m: string) { mode = m; render(); },
  };
}
