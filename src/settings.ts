/**
 * Settings shared by TermInk and TermPaper: a schema of sections and fields,
 * persisted to localStorage, rendered as a plain HTML page the host app styles
 * and shows however it likes. No app logic lives here; hosts react in onChange.
 */

type Base = { key: string; label: string; parent?: string };
export type Field =
  | (Base & { type: "toggle"; default: boolean })
  | (Base & { type: "range"; default: number; min: number; max: number; step: number; unit?: string })
  | (Base & { type: "select"; default: string; options: [string, string][] })
  // options: [css family, label]; each choice is previewed in its own face
  | (Base & { type: "font"; default: string; options: [string, string][] })
  | (Base & { type: "color"; default: string });
// sections sharing a tab and title render as one group, so hosts can add fields to a shared group
export type Section = { tab?: string; title: string; fields: Field[] };
export type Values = Record<string, boolean | number | string>;

/** The fields every terminal app here shares; hosts add their own sections. */
export const CORE: Section[] = [
  { tab: "Text", title: "Typeface", fields: [
    { key: "font", label: "Font", type: "font", default: "Monaspace Xenon", options: [
      ["Monaspace Xenon", "Monaspace Xenon · slab serif"], ["Monaspace Neon", "Monaspace Neon · neo-grotesque"],
      ["Monaspace Argon", "Monaspace Argon · humanist"], ["Monaspace Krypton", "Monaspace Krypton · mechanical"],
      ["Monaspace Radon", "Monaspace Radon · handwriting"], ["Victor Mono", "Victor Mono · cursive italics"],
      ["Maple Mono", "Maple Mono · rounded"],
      ["Source Code Pro", "Source Code Pro · classic"], ["Fira Code", "Fira Code · ligatures"],
      ["JetBrains Mono", "JetBrains Mono · tall x-height"], ["Libertinus Mono", "Libertinus Mono · typewriter serif"],
      ["Xanh Mono", "Xanh Mono · display serif"], ["JuliaMono", "JuliaMono · wide Unicode"],
      ["Spline Sans Mono", "Spline Sans Mono · geometric"], ["Ioskeley Mono", "Ioskeley Mono · narrow"],
    ] },
  ] },
  { tab: "Text", title: "Size & spacing", fields: [
    { key: "fontSize", label: "Font size", type: "range", default: 15, min: 9, max: 32, step: 1, unit: "px" },
    { key: "lineHeight", label: "Line spacing", type: "range", default: 1.4, min: 1, max: 2, step: 0.05 },
    { key: "margin", label: "Margin", type: "range", default: 30, min: 4, max: 96, step: 2, unit: "px" },
  ] },
  { tab: "Text", title: "Ink", fields: [
    { key: "cursor", label: "Text cursor", type: "select", default: "block",
      options: [["block", "Block"], ["bar", "Bar"], ["underline", "Underline"]] },
  ] },
  { tab: "Terminal", title: "Input", fields: [
    { key: "optionMeta", label: "Option key acts as Meta", type: "toggle", default: false },
  ] },
  { tab: "Terminal", title: "History", fields: [
    { key: "scrollback", label: "Scrollback", type: "range", default: 5000, min: 1000, max: 50000, step: 1000, unit: " lines" },
  ] },
];

export interface Settings {
  values: Values;
  defaults: Values;
  el: HTMLElement;
  set(key: string, v: boolean | number | string): void;
}

export function createSettings(
  sections: Section[], storageKey: string, onChange: (v: Values, key?: string) => void,
  overrides: Values = {},
): Settings {
  const fields = sections.flatMap((s) => s.fields);
  const defaults: Values = Object.fromEntries(fields.map((f) => [f.key, overrides[f.key] ?? f.default]));
  let saved: Values = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); } catch { /* corrupt: use defaults */ }
  const values: Values = { ...defaults, ...saved };

  const tabs = [...new Set(sections.map((s) => s.tab ?? ""))];
  const groups: { tab: string; title: string; fields: Field[] }[] = [];
  for (const s of sections) {
    const tab = s.tab ?? "", g = groups.find((x) => x.tab === tab && x.title === s.title);
    g ? g.fields.push(...s.fields) : groups.push({ tab, title: s.title, fields: [...s.fields] });
  }
  const el = document.createElement("div");
  el.className = "settings";
  el.innerHTML = `<header><h1>Settings</h1>`
    + (tabs.length > 1 ? `<nav class="tabs">${tabs.map((t) => `<button type="button" data-tab="${t}">${t}</button>`).join("")}</nav>` : "")
    + `</header>` + groups.map((g) =>
      `<section data-tab="${g.tab}"><h2>${g.title}</h2>${g.fields.map(row).join("")}</section>`).join("")
    + `<button class="reset" type="button">Reset all to defaults</button>`;

  function showTab(t: string) {
    el.querySelectorAll<HTMLElement>("section").forEach((s) => { s.hidden = s.dataset.tab !== t; });
    el.querySelectorAll<HTMLElement>("[data-tab]:not(section)").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  }

  // every row: label on the left, control on the right
  function row(f: Field): string {
    const indent = f.parent ? " child" : "";
    if (f.type === "toggle")
      return `<label class="row toggle${indent}" data-row="${f.key}"><span>${f.label}</span><input type="checkbox" data-k="${f.key}"></label>`;
    if (f.type === "range")
      return `<label class="row range${indent}" data-row="${f.key}"><span>${f.label}</span>`
        + `<output></output><input type="range" data-k="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}"></label>`;
    if (f.type === "color")
      return `<label class="row color${indent}" data-row="${f.key}"><input type="color" data-k="${f.key}"><span>${f.label}</span></label>`;
    if (f.type === "font")
      return `<div class="row font${indent}" data-row="${f.key}"><span class="fonts">`
        + f.options.map(([v, l]) => {
          const [name, kind] = l.split(" · ");
          return `<button type="button" data-k="${f.key}" data-v="${v}"><b style="font-family:'${v}',monospace">${name}</b><i>${kind ?? ""}</i></button>`;
        }).join("")
        + `</span></div>`;
    return `<div class="row select${indent}" data-row="${f.key}"><span>${f.label}</span><span class="seg">`
      + f.options.map(([v, l]) => `<button type="button" data-k="${f.key}" data-v="${v}">${l}</button>`).join("")
      + `</span></div>`;
  }

  function sync() {
    for (const f of fields) {
      const r = el.querySelector<HTMLElement>(`[data-row="${f.key}"]`)!;
      // sub-options only appear while their parent is on
      r.hidden = f.parent !== undefined && !values[f.parent];
      if (f.type === "toggle") {
        r.querySelector("input")!.checked = !!values[f.key];
      } else if (f.type === "color") {
        r.querySelector("input")!.value = String(values[f.key]);
      } else if (f.type === "range") {
        r.querySelector("input")!.value = String(values[f.key]);
        r.querySelector("output")!.textContent = `${values[f.key]}${f.unit ?? ""}`;
      } else {
        r.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
          b.classList.toggle("on", b.dataset.v === values[f.key]);
        });
      }
    }
  }

  function set(key: string, v: boolean | number | string) {
    values[key] = v;
    // store only what differs from the defaults, so changed defaults still reach the user
    const diff = Object.fromEntries(Object.entries(values).filter(([k, x]) => x !== defaults[k]));
    localStorage.setItem(storageKey, JSON.stringify(diff));
    sync();
    onChange(values, key);
  }

  el.addEventListener("input", (e) => {
    const i = e.target as HTMLInputElement, k = i.dataset.k;
    if (!k) return;
    set(k, i.type === "checkbox" ? i.checked : i.type === "color" ? i.value : Number(i.value));
  });
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.tab !== undefined) { showTab(b.dataset.tab); el.parentElement?.scrollTo(0, 0); }
    else if (b.classList.contains("reset")) {
      Object.assign(values, defaults);
      localStorage.removeItem(storageKey);
      sync(); onChange(values);
    } else if (b.dataset.k) set(b.dataset.k, b.dataset.v!);
  });

  sync();
  showTab(tabs[0]);
  return { values, defaults, el, set };
}
