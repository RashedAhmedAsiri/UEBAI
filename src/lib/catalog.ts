import parts from "@/catalog/parts.json";
import itemsJson from "@/catalog/items.json";
import packsJson from "@/catalog/theme-packs.json";
import type { RobotConfig, BodySlot, Personality, Subject } from "./schemas";

export type Localized = { en: string; ar: string };
export type ItemSlot = "top" | "neck" | "headwear" | "eyewear" | "hand" | "back" | "badge" | "desk";
export interface Item {
  id: string;
  slot: ItemSlot;
  name: Localized;
  subjects: string[];
  builder: string;
  color: string;
  tintable: boolean;
  symbol?: string;
}
export interface ThemePack {
  name: Localized;
  keywords: string[];
  outfit: RobotConfig["wardrobe"];
}

export const PARTS = parts as {
  slots: Record<BodySlot, { name: Localized; variants: string[] }>;
  face: { eyes: string[]; mouth: string[]; screenColors: string[] };
  materials: string[];
  paint: string[];
};
export const ITEMS = itemsJson as Item[];
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const THEME_PACKS = packsJson as Record<string, ThemePack>;

export const BODY_SLOTS: BodySlot[] = ["head", "antenna", "ears", "torso", "chest", "arms", "hands", "base"];
export const WARDROBE_SLOTS = ["top", "neck", "headwear", "eyewear", "leftHand", "rightHand", "back", "badges", "deskProp"] as const;
export type WardrobeSlot = (typeof WARDROBE_SLOTS)[number];

export function itemSlotFor(ws: WardrobeSlot): ItemSlot {
  if (ws === "leftHand" || ws === "rightHand") return "hand";
  if (ws === "badges") return "badge";
  if (ws === "deskProp") return "desk";
  return ws;
}

export function humanize(id: string) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Display names for part variants, face styles and materials. */
export const PART_NAMES: Record<string, Localized> = {
  cube: { en: "Cube", ar: "مكعّب" }, dome: { en: "Dome", ar: "قبّة" }, crt_tv: { en: "Retro TV", ar: "تلفاز قديم" }, capsule: { en: "Capsule", ar: "كبسولة" },
  tin_can: { en: "Tin can", ar: "علبة صفيح" }, lightbulb: { en: "Light bulb", ar: "مصباح" }, saucer: { en: "Saucer", ar: "صحن طائر" }, radio: { en: "Radio", ar: "مذياع" },
  single_ball: { en: "Single ball", ar: "كرة واحدة" }, twin_balls: { en: "Twin balls", ar: "كرتان" }, dish: { en: "Dish", ar: "طبق لاقط" },
  propeller: { en: "Propeller", ar: "مروحة" }, lightning_rod: { en: "Lightning rod", ar: "مانعة صواعق" }, none: { en: "None", ar: "بدون" },
  bolts: { en: "Bolts", ar: "براغٍ" }, headphones: { en: "Headphones", ar: "سمّاعات" }, radar: { en: "Radar", ar: "رادار" },
  barrel: { en: "Barrel", ar: "برميل" }, box: { en: "Box", ar: "صندوق" }, oval: { en: "Oval", ar: "بيضاوي" }, vending: { en: "Vending machine", ar: "آلة بيع" }, boiler: { en: "Boiler", ar: "غلّاية" },
  dials: { en: "Dials", ar: "مقابض" }, gauge: { en: "Gauge", ar: "عدّاد" }, tape_reels: { en: "Tape reels", ar: "بكرات شريط" }, heart: { en: "Heart", ar: "قلب" }, keypad: { en: "Keypad", ar: "لوحة أرقام" }, blank: { en: "Blank", ar: "فارغة" },
  tubes: { en: "Tubes", ar: "أنابيب" }, springs: { en: "Springs", ar: "نوابض" }, pistons: { en: "Pistons", ar: "مكابس" }, noodle: { en: "Noodle", ar: "أذرع مرنة" },
  claws: { en: "Claws", ar: "مخالب" }, mitts: { en: "Mitts", ar: "قفّازات" }, grippers: { en: "Grippers", ar: "ملاقط" }, suction: { en: "Suction cups", ar: "شفّاطات" },
  legs: { en: "Legs", ar: "أرجل" }, wheel: { en: "Wheel", ar: "عجلة" }, treads: { en: "Treads", ar: "جنزير" }, hover: { en: "Hover jet", ar: "حوّامة" }, pogo: { en: "Pogo spring", ar: "عصا قفز" },
  pixel_dots: { en: "Pixel dots", ar: "نقاط" }, ovals: { en: "Ovals", ar: "بيضاوية" }, visor: { en: "Visor", ar: "شريط ضوئي" }, anime: { en: "Sparkly", ar: "لامعة" }, glasses: { en: "Glasses", ar: "نظّارة" }, cyclops: { en: "Cyclops", ar: "عين واحدة" },
  line: { en: "Line", ar: "خط" }, grille: { en: "Grille", ar: "شبكة" }, equalizer: { en: "Equalizer", ar: "موجات صوت" },
  polished_chrome: { en: "Polished chrome", ar: "كروم لامع" }, brushed_steel: { en: "Brushed steel", ar: "فولاذ مصقول" }, painted_enamel: { en: "Painted enamel", ar: "طلاء مينا" },
  toy_plastic: { en: "Toy plastic", ar: "بلاستيك لامع" }, copper: { en: "Copper", ar: "نحاس أحمر" }, brass: { en: "Brass", ar: "نحاس أصفر" }, gold: { en: "Gold", ar: "ذهب" },
  rusty_iron: { en: "Rusty iron", ar: "حديد صدئ" }, wood_panel: { en: "Wood", ar: "خشب" }, carbon_fiber: { en: "Carbon fiber", ar: "ألياف كربون" }, rubber: { en: "Rubber", ar: "مطّاط" },
};
export const partName = (id: string): Localized => PART_NAMES[id] ?? { en: humanize(id), ar: humanize(id) };

export const TITLES: Record<"ar" | "en", string[]> = {
  ar: ["الأستاذ", "الأستاذة", "الدكتور", "الدكتورة", "البروفيسور", "المدرّب"],
  en: ["Prof.", "Dr.", "Mr.", "Ms.", "Coach", "Sensei"],
};

/** Match a free-text subject name to a theme pack id (or null). */
export function matchThemePack(subjectName: string): string | null {
  const s = subjectName.trim().toLowerCase();
  if (!s) return null;
  let best: { id: string; score: number } | null = null;
  for (const [id, pack] of Object.entries(THEME_PACKS)) {
    for (const kw of [...pack.keywords, pack.name.en.toLowerCase(), pack.name.ar]) {
      const k = kw.toLowerCase();
      const score = s === k ? 3 : s.includes(k) || k.includes(s) ? 2 : 0;
      if (score && (!best || score > best.score)) best = { id, score };
    }
  }
  return best?.id ?? null;
}

/** Keep only item IDs that exist in the catalog and fit the slot. */
export function sanitizeWardrobe(w: Partial<RobotConfig["wardrobe"]>): RobotConfig["wardrobe"] {
  const ok = (id: string | null | undefined, slot: ItemSlot) =>
    id && ITEM_BY_ID.get(id)?.slot === slot ? id : null;
  return {
    top: ok(w.top, "top"),
    neck: ok(w.neck, "neck"),
    headwear: ok(w.headwear, "headwear"),
    eyewear: ok(w.eyewear, "eyewear"),
    leftHand: ok(w.leftHand, "hand"),
    rightHand: ok(w.rightHand, "hand"),
    back: ok(w.back, "back"),
    badges: (w.badges ?? []).filter((b) => ok(b, "badge")).slice(0, 3),
    deskProp: ok(w.deskProp, "desk"),
  };
}

/** Turn a flat list of LLM-suggested IDs into a wardrobe (unknown IDs ignored). */
export function wardrobeFromIds(ids: string[]): RobotConfig["wardrobe"] {
  const w: RobotConfig["wardrobe"] = {
    top: null, neck: null, headwear: null, eyewear: null, leftHand: null, rightHand: null, back: null, badges: [], deskProp: null,
  };
  for (const id of ids) {
    const item = ITEM_BY_ID.get(id);
    if (!item) continue;
    switch (item.slot) {
      case "hand":
        if (!w.rightHand) w.rightHand = id;
        else if (!w.leftHand) w.leftHand = id;
        break;
      case "badge":
        if (w.badges.length < 3 && !w.badges.includes(id)) w.badges.push(id);
        break;
      case "desk":
        w.deskProp ??= id;
        break;
      default:
        if (!w[item.slot]) w[item.slot] = id;
    }
  }
  return w;
}

export function emptyWardrobe(): RobotConfig["wardrobe"] {
  return wardrobeFromIds([]);
}

export function defaultRobot(): RobotConfig {
  return {
    version: 1,
    body: {
      head: { variant: "crt_tv", material: "painted_enamel", tint: "#3E7CB1", wear: 0.2 },
      face: { eyes: "ovals", mouth: "grille", screenColor: "#7CFFB2" },
      antenna: { variant: "twin_balls", material: "brass" },
      ears: { variant: "bolts", material: "brushed_steel" },
      torso: { variant: "barrel", material: "brushed_steel", tint: "#C9CED3", wear: 0.1 },
      chest: { variant: "gauge" },
      arms: { variant: "springs", material: "polished_chrome" },
      hands: { variant: "mitts", material: "toy_plastic", tint: "#F2B632" },
      base: { variant: "treads", material: "rubber", tint: "#3A3F44" },
      proportions: { height: 1, width: 1, headSize: 1.1, armLength: 1 },
    },
    wardrobe: emptyWardrobe(),
  };
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export function randomRobot(keepWardrobe?: RobotConfig["wardrobe"]): RobotConfig {
  const mats = PARTS.materials;
  const part = (slot: BodySlot) => ({
    variant: pick(PARTS.slots[slot].variants),
    material: pick(mats),
    tint: pick(PARTS.paint),
    wear: Math.round(Math.random() * 0.5 * 100) / 100,
  });
  const r = (min: number, max: number) => Math.round((min + Math.random() * (max - min)) * 100) / 100;
  return {
    version: 1,
    body: {
      head: part("head"),
      face: { eyes: pick(PARTS.face.eyes), mouth: pick(PARTS.face.mouth), screenColor: pick(PARTS.face.screenColors) },
      antenna: part("antenna"),
      ears: part("ears"),
      torso: part("torso"),
      chest: { variant: pick(PARTS.slots.chest.variants) },
      arms: part("arms"),
      hands: part("hands"),
      base: part("base"),
      proportions: { height: r(0.85, 1.2), width: r(0.85, 1.2), headSize: r(0.9, 1.3), armLength: r(0.8, 1.25) },
    },
    wardrobe: keepWardrobe ?? emptyWardrobe(),
  };
}

export function defaultPersonality(lang: "ar" | "en" = "ar"): Personality {
  const ar = lang === "ar";
  return {
    name: ar ? "بولت" : "Bolt",
    title: ar ? "الأستاذ" : "Prof.",
    catchphrases: [ar ? "بيب بوب، هيّا نتعلّم!" : "Beep-boop, let's learn!"],
    backstory: "",
    preset: "patient_mentor",
    sliders: { warmth: 8, humor: 5, strictness: 3, formality: 4, talkativeness: 5, encouragement: 8, socratic: 5, creativity: 6 },
    habits: ["analogies", "examples", "check_question"],
    language: ar ? { primary: "ar", secondary: null, dialect: "msa" } : { primary: "en", secondary: null, dialect: null },
    level: "high_school",
    voice: { enabled: false, voiceId: null, pitch: 1.2, rate: 1, robotFilter: 0.4 },
  };
}

export function defaultSubject(lang: "ar" | "en" = "ar"): Subject {
  return { name: "", course: "", level: "high_school", curriculum: "", materialsLanguage: lang };
}

export const PRESETS: Record<string, { name: Localized; sliders: Personality["sliders"]; habits: Personality["habits"]; stamp: string }> = {
  patient_mentor: { name: { en: "Patient Mentor", ar: "المرشد الصبور" }, stamp: "#2E7D4F", sliders: { warmth: 9, humor: 4, strictness: 2, formality: 4, talkativeness: 5, encouragement: 9, socratic: 5, creativity: 5 }, habits: ["examples", "step_by_step", "check_question"] },
  strict_professor: { name: { en: "Strict Professor", ar: "الأستاذ الصارم" }, stamp: "#8E2C2C", sliders: { warmth: 3, humor: 1, strictness: 9, formality: 9, talkativeness: 4, encouragement: 4, socratic: 6, creativity: 3 }, habits: ["step_by_step", "bullet_summary"] },
  mad_scientist: { name: { en: "Mad Scientist", ar: "العالِم المجنون" }, stamp: "#6B2C8E", sliders: { warmth: 7, humor: 9, strictness: 2, formality: 2, talkativeness: 8, encouragement: 8, socratic: 4, creativity: 10 }, habits: ["analogies", "examples", "emojis"] },
  storyteller: { name: { en: "Storyteller", ar: "الحكواتي" }, stamp: "#B8622A", sliders: { warmth: 8, humor: 6, strictness: 2, formality: 3, talkativeness: 9, encouragement: 7, socratic: 3, creativity: 10 }, habits: ["analogies", "examples"] },
  socratic_guide: { name: { en: "Socratic Guide", ar: "المحاور السقراطي" }, stamp: "#2B5C8A", sliders: { warmth: 6, humor: 4, strictness: 5, formality: 5, talkativeness: 4, encouragement: 7, socratic: 10, creativity: 6 }, habits: ["check_question"] },
  hype_coach: { name: { en: "Hype Coach", ar: "المدرب المتحمس" }, stamp: "#D63A3A", sliders: { warmth: 9, humor: 8, strictness: 4, formality: 1, talkativeness: 7, encouragement: 10, socratic: 4, creativity: 7 }, habits: ["examples", "mini_quiz", "emojis"] },
  wise_grandpa: { name: { en: "Wise Grandpa-bot", ar: "الجد الحكيم" }, stamp: "#6B5A3A", sliders: { warmth: 10, humor: 5, strictness: 3, formality: 5, talkativeness: 6, encouragement: 8, socratic: 5, creativity: 8 }, habits: ["analogies", "examples", "bullet_summary"] },
};
