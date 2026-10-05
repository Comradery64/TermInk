/**
 * Settings shared by TermInk and TermPaper: a schema of sections and fields,
 * persisted to localStorage, rendered as a plain HTML page the host app styles
 * and shows however it likes. No app logic lives here; hosts react in onChange.
 */

type Base = { key: string; label: string; parent?: string };
export type Field =
  | (Base & { type: "toggle"; default: boolean })
  | (Base & { type: "range"; default: number; min: number; max: number; step: number; unit?: string })
  | (Base & { type: "select"; default: string; options: [string, string][] });
export type Section = { title: string; fields: Field[] };
export type Values = Record<string, boolean | number | string>;

/** The fields every terminal app here shares; hosts add their own sections. */
export const CORE: Section[] = [
  { title: "Text", fields: [
    { key: "fontSize", label: "Font size", type: "range", default: 15, min: 9, max: 32, step: 1, unit: "px" },
    { key: "lineHeight", label: "Line spacing", type: "range", default: 1.4, min: 1, max: 2, step: 0.05 },
    { key: "cursor", label: "Cursor", type: "select", default: "block",
      options: [["block", "Block"], ["bar", "Bar"], ["underline", "Underline"]] },
  ] },
  { title: "Layout", fields: [
    { key: "margin", label: "Margin", type: "range", default: 30, min: 4, max: 96, step: 2, unit: "px" },
  ] },
  { title: "Behaviour", fields: [
    { key: "optionMeta", label: "Option key acts as Meta", type: "toggle", default: false },
    { key: "scrollback", label: "Scrollback", type: "range", default: 5000, min: 1000, max: 50000, step: 1000, unit: " lines" },
  ] },
];

export interface Settings {
  values: Values;
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

  const el = document.createElement("div");
  el.className = "settings";
  el.innerHTML = `<h1>Settings</h1>` + sections.map((s) =>
    `<section><h2>${s.title}</h2>${s.fields.map(row).join("")}</section>`).join("")
    + `<button class="reset" type="button">Reset to defaults</button>`;

  function row(f: Field): string {
    const indent = f.parent ? " child" : "";
    if (f.type === "toggle")
      return `<label class="row toggle${indent}" data-row="${f.key}"><input type="checkbox" data-k="${f.key}"><span>${f.label}</span></label>`;
    if (f.type === "range")
      return `<label class="row range${indent}" data-row="${f.key}"><span>${f.label}</span>`
        + `<input type="range" data-k="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}"><output></output></label>`;
    return `<div class="row select${indent}" data-row="${f.key}"><span>${f.label}</span><span class="seg">`
      + f.options.map(([v, l]) => `<button type="button" data-k="${f.key}" data-v="${v}">${l}</button>`).join("")
      + `</span></div>`;
  }

  function sync() {
    for (const f of fields) {
      const r = el.querySelector<HTMLElement>(`[data-row="${f.key}"]`)!;
      const off = f.parent !== undefined && !values[f.parent];
      r.classList.toggle("disabled", off);
      if (f.type === "toggle") {
        const i = r.querySelector("input")!; i.checked = !!values[f.key]; i.disabled = off;
      } else if (f.type === "range") {
        const i = r.querySelector("input")!; i.value = String(values[f.key]); i.disabled = off;
        r.querySelector("output")!.textContent = `${values[f.key]}${f.unit ?? ""}`;
      } else {
        r.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
          b.classList.toggle("on", b.dataset.v === values[f.key]); b.disabled = off;
        });
      }
    }
  }

  function set(key: string, v: boolean | number | string) {
    values[key] = v;
    localStorage.setItem(storageKey, JSON.stringify(values));
    sync();
    onChange(values, key);
  }

  el.addEventListener("input", (e) => {
    const i = e.target as HTMLInputElement, k = i.dataset.k;
    if (!k) return;
    set(k, i.type === "checkbox" ? i.checked : Number(i.value));
  });
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.classList.contains("reset")) {
      Object.assign(values, defaults);
      localStorage.removeItem(storageKey);
      sync(); onChange(values);
    } else if (b.dataset.k) set(b.dataset.k, b.dataset.v!);
  });

  sync();
  return { values, el, set };
}
