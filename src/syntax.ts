/**
 * Syntax highlighting for a terminal stream, done on the bytes before xterm
 * sees them. Two lexers:
 *  - command line (between OSC 133 B and C): command word, flags, strings, operators
 *  - output: URLs, paths, numbers, quoted strings, error and warning words
 * Output is only touched while the app has not set its own foreground color and
 * the normal screen is active, so colored tools and full-screen apps are left alone.
 * Each token gets a weight/style as well as a color, so they stay distinct in greyscale.
 */

export type Token = "command" | "flag" | "string" | "operator" | "url" | "path" | "number" | "error" | "warning";
export const TOKENS: [Token, string, string][] = [   // key, label, default color
  ["command", "Commands", "#1f6feb"],
  ["flag", "Flags", "#8250df"],
  ["string", "Strings", "#1a7f37"],
  ["operator", "Operators", "#9a6700"],
  ["url", "URLs", "#0969da"],
  ["path", "Paths", "#6639ba"],
  ["number", "Numbers", "#bc4c00"],
  ["error", "Errors", "#cf222e"],
  ["warning", "Warnings", "#9a6700"],
];
const STYLE: Partial<Record<Token, string>> = { command: "1", error: "1", string: "3", path: "3", url: "4", warning: "1" };

export interface SyntaxOptions {
  commands: boolean;
  output: boolean;
  color(t: Token): [number, number, number] | null;   // null: style only, keep the ink
  inputSgr: string;                              // SGR the host uses for typed text
}

const ESC = /(\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_]))/;
const OUT = new RegExp([
  /(?<url>https?:\/\/[^\s'"<>)]+)/,
  /(?<string>"[^"\n]{0,200}"|'[^'\n]{0,200}')/,
  /(?<path>(?:~|\.{1,2})?\/[\w.@%+-]+(?:\/[\w.@%+-]+)*\/?)/,
  /(?<error>\b(?:error|errors|failed|failure|fatal|panic|denied|ERR!?)\b)/,
  /(?<warning>\b(?:warn|warning|warnings|deprecated)\b)/,
  /(?<number>\b\d+(?:\.\d+)?\b)/,
].map((r) => r.source).join("|"), "gi");

export function createSyntax(opts: () => SyntaxOptions) {
  let fgDefault = true;     // app has not set a foreground color
  let alt = false;          // full-screen app on the alternate screen
  let input = false;        // inside the typed command line
  // command-line lexer state, carried across chunks (keys arrive one at a time)
  let cmdPos = true, inFlag = false, wordStart = true, inWord = false, quote = "";

  const sgr = (t: Token) => {
    const c = opts().color(t);
    const parts = [STYLE[t], c && `38;2;${c.join(";")}`].filter(Boolean);
    return parts.length ? `\x1b[${parts.join(";")}m` : "";
  };
  // undo a token's style and return to whatever color the text had before it
  const after = (t: Token) => `\x1b[${{ "1": "22;", "3": "23;", "4": "24;" }[STYLE[t] ?? ""] ?? ""}${input ? opts().inputSgr.slice(2, -1) : "39"}m`;

  function trackSgr(seq: string) {
    if (seq === opts().inputSgr) { input = true; cmdPos = true; inFlag = false; wordStart = true; inWord = false; quote = ""; return; }
    const m = /^\x1b\[([0-9;]*)m$/.exec(seq);
    if (m) {
      const p = m[1].split(";");
      for (let i = 0; i < p.length; i++) {
        const n = +p[i] || 0;
        if (n === 0 || n === 39) { fgDefault = true; if (n === 39 || n === 0) input = false; }
        else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) fgDefault = false;
        else if (n === 38) { fgDefault = false; i += p[i + 1] === "2" ? 4 : 2; }
        else if (n === 48 || n === 58) i += p[i + 1] === "2" ? 4 : 2;
      }
      return;
    }
    if (/^\x1b\[\?(1049|1047|47)h$/.test(seq)) alt = true;
    if (/^\x1b\[\?(1049|1047|47)l$/.test(seq)) alt = false;
  }

  /** Command line: classify character by character, since the shell echoes keys one by one. */
  function command(text: string): string {
    let out = "", cur: Token | null = null;
    const emit = (ch: string, t: Token | null) => {
      if (t !== cur) { if (cur) out += after(cur); if (t) out += sgr(t); cur = t; }
      out += ch;
    };
    for (const ch of text) {
      if (ch < " ") { out += ch; continue; }          // backspace and friends: not part of a word
      if (quote) { emit(ch, "string"); if (ch === quote) quote = ""; continue; }
      if (ch === '"' || ch === "'") { quote = ch; emit(ch, "string"); continue; }
      if (/[|;&<>]/.test(ch)) {
        emit(ch, "operator");
        cmdPos = ch !== ">" && ch !== "<"; inFlag = false; wordStart = true; inWord = false; continue;
      }
      if (ch === " " || ch === "\t") {
        emit(ch, null);
        if (inWord) cmdPos = false;          // the command word just ended
        inFlag = false; wordStart = true; inWord = false; continue;
      }
      if (ch === "-" && wordStart && !cmdPos) inFlag = true;
      wordStart = false; inWord = true;
      emit(ch, inFlag ? "flag" : cmdPos ? "command" : null);
    }
    if (cur) out += after(cur);
    return out;
  }

  function output(text: string): string {
    return text.replace(OUT, (m, ...rest) => {
      const groups = rest[rest.length - 1] as Record<string, string | undefined>;
      const t = (Object.keys(groups).find((k) => groups[k] !== undefined) ?? "number") as Token;
      return sgr(t) + m + after(t);
    });
  }

  return function highlight(s: string): string {
    const o = opts();
    if (!o.commands && !o.output) return s;
    return s.split(ESC).map((part, i) => {
      if (i % 2) { trackSgr(part); return part; }
      if (!part || alt) return part;
      if (input) return o.commands ? command(part) : part;
      return o.output && fgDefault ? output(part) : part;
    }).join("");
  };
}
