/**
 * Arabic-first i18n. Arabic is the default language of the whole site; English is the
 * translation layer. Keys are the English source strings (easy to read in code), and
 * every key must have an Arabic entry in ./ar.ts — a unit test enforces this.
 * Keys may contain {placeholders}; incoming server messages are matched against those
 * patterns so dynamic messages ("Reading {file}…") are translated too.
 */
import { AR } from "./ar";

export type Lang = "ar" | "en";
export const LANG_COOKIE = "roboprof.lang";
export type Vars = Record<string, string | number>;

export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let patterns: { re: RegExp; names: string[]; ar: string }[] | null = null;
function compiled() {
  if (!patterns) {
    patterns = Object.entries(AR)
      .filter(([k]) => /\{\w+\}/.test(k))
      .map(([k, ar]) => {
        const names: string[] = [];
        const src = k.split(/(\{\w+\})/).map((part) => {
          const m = part.match(/^\{(\w+)\}$/);
          if (m) { names.push(m[1]); return "([\\s\\S]+?)"; }
          return esc(part);
        }).join("");
        return { re: new RegExp(`^${src}$`), names, ar };
      })
      // Longest (most specific) patterns first.
      .sort((a, b) => b.re.source.length - a.re.source.length);
  }
  return patterns;
}

const missing = new Set<string>();

/** Translate a known UI key (with optional variables). */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  if (lang === "en") return interpolate(key, vars);
  const ar = AR[key];
  if (ar !== undefined) return interpolate(ar, vars);
  const viaPattern = translateMessage("ar", key);
  if (viaPattern !== key) return viaPattern;
  if (process.env.NODE_ENV !== "production" && !missing.has(key)) {
    missing.add(key);
    console.warn(`[i18n] missing Arabic for: ${JSON.stringify(key)}`);
  }
  return interpolate(key, vars);
}

/** Translate a free-form message (e.g. from the server) by exact key or {pattern} match. */
export function translateMessage(lang: Lang, msg: string): string {
  if (lang === "en" || !msg) return msg;
  if (AR[msg] !== undefined) return AR[msg];
  for (const p of compiled()) {
    const m = msg.match(p.re);
    if (m) {
      const vars: Vars = {};
      p.names.forEach((n, i) => { vars[n] = translateMessage(lang, m[i + 1]); });
      return interpolate(p.ar, vars);
    }
  }
  return msg;
}

/** Arabic-Indic digits in Arabic mode. */
export function formatNumber(lang: Lang, n: number): string {
  return n.toLocaleString(lang === "ar" ? "ar-SA" : "en-US");
}
