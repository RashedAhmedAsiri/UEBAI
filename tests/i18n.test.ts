import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/ar";
import { translate, translateMessage } from "@/lib/i18n/translate";
import { ITEMS, PARTS, PART_NAMES, PRESETS, THEME_PACKS } from "@/lib/catalog";
import { sliderPhrase } from "@/lib/ai/personality";
import { SLIDER_KEYS } from "@/lib/schemas";

function keysInSource(): string[] {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) {
        const s = fs.readFileSync(p, "utf8");
        for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
        // Label maps whose values are passed through t()
        for (const block of s.matchAll(/(?:_LABEL|labels|KIND)[^=]*=\s*\{([^}]*)\}/g)) for (const m of block[1].matchAll(/:\s*"([^"]+)"/g)) out.add(m[1]);
      }
    }
  };
  walk("src");
  return [...out];
}

// Tokens that may legitimately stay in Latin script inside Arabic text.
const ALLOWED_LATIN = /ANTHROPIC_API_KEY|GEMINI_API_KEY|DEEPSEEK_API_KEY|UEBAI|\.env\.local|Esc|Vercel|Upstash Redis|Storage/g; // (Vercel/Upstash: product and tab names shown in English)

describe("Arabic-first i18n", () => {
  it("every UI string used in the code has an Arabic translation", () => {
    const missing = keysInSource().filter((k) => AR[k] === undefined);
    expect(missing).toEqual([]);
  });

  it("slider phrases, part names, items, presets and theme packs are translated", () => {
    for (const k of SLIDER_KEYS) for (const v of [1, 5, 9]) expect(AR[sliderPhrase(k, v)], sliderPhrase(k, v)).toBeDefined();
    for (const v of [...Object.values(PARTS.slots).flatMap((s) => s.variants), ...PARTS.face.eyes, ...PARTS.face.mouth, ...PARTS.materials]) {
      expect(PART_NAMES[v], v).toBeDefined();
    }
    for (const x of [...ITEMS.map((i) => i.name), ...Object.values(PRESETS).map((p) => p.name), ...Object.values(THEME_PACKS).map((p) => p.name), ...Object.values(PARTS.slots).map((s) => s.name), ...Object.values(PART_NAMES)]) {
      expect(x.ar).toMatch(/[؀-ۿ]/);
    }
  });

  it("Arabic values contain no English words", () => {
    const offenders = Object.entries(AR).filter(([, v]) => /[A-Za-z]{2,}/.test(v.replace(ALLOWED_LATIN, "").replace(/\{\w+\}/g, "")));
    expect(offenders.map(([k]) => k)).toEqual([]);
  });

  it("translates dynamic server messages by pattern", () => {
    expect(translateMessage("ar", "Reading biology.pdf…")).toBe("يقرأ biology.pdf…");
    expect(translateMessage("ar", "Finding topics… (3/7)")).toBe("يبحث عن المواضيع… (3/7)");
    expect(translateMessage("ar", "Teacher not found")).toBe("لم يُعثر على المعلّم");
    expect(translateMessage("en", "Teacher not found")).toBe("Teacher not found");
    expect(translate("ar", "{n} topics", { n: "٥" })).toBe("٥ موضوع");
  });
});
