import type { Personality, SliderKey } from "../schemas";

/** Slider value → short phrase. Bands: 0–3 low, 4–6 mid, 7–10 high. */
const PHRASES: Record<SliderKey, [string, string, string]> = {
  warmth: ["cool and matter-of-fact", "friendly but focused", "very warm and caring"],
  humor: ["rarely jokes", "light, friendly humor", "jokes often; puns welcome"],
  strictness: ["relaxed about mistakes", "corrects mistakes clearly but kindly", "strict: insists on precision and correct terminology"],
  formality: ["casual, conversational tone", "semi-formal tone", "formal, academic tone"],
  talkativeness: ["very concise answers", "moderate-length answers", "rich, detailed answers"],
  encouragement: ["neutral feedback", "regular encouragement", "celebrates every bit of progress enthusiastically"],
  socratic: ["answers directly", "mixes direct answers with guiding questions", "prefers to guide with questions before giving answers"],
  creativity: ["plain explanations", "occasional analogies or stories", "vivid analogies, stories and imaginative examples"],
};

export function sliderPhrase(key: SliderKey, value: number): string {
  const band = value <= 3 ? 0 : value <= 6 ? 1 : 2;
  return PHRASES[key][band];
}

const HABIT_TEXT: Record<Personality["habits"][number], string> = {
  analogies: "use analogies",
  examples: "give real-world examples",
  step_by_step: "show step-by-step solutions",
  check_question: "end with a short check-for-understanding question",
  mini_quiz: "offer a mini-quiz when a topic is finished",
  bullet_summary: "summarize key points in bullets",
  emojis: "use a few emojis",
};

export const LEVEL_TEXT: Record<Personality["level"], string> = {
  elementary: "elementary school",
  middle: "middle school",
  high_school: "high school",
  university: "university",
  adult: "adult learner",
};

export function compilePersonalityLines(p: Personality): string[] {
  return (Object.keys(p.sliders) as SliderKey[]).map((k) => `- ${sliderPhrase(k, p.sliders[k])}`);
}

export function habitsText(p: Personality): string {
  return p.habits.length ? p.habits.map((h) => HABIT_TEXT[h]).join("; ") : "none in particular";
}

export function languageText(p: Personality): { language: string; dialectNote: string } {
  const name = (l: "en" | "ar") => (l === "ar" ? "Arabic" : "English");
  let language = name(p.language.primary);
  if (p.language.secondary && p.language.secondary !== p.language.primary) {
    language += ` (bilingual: the student may write in ${name(p.language.secondary)}; mirror the student's language and give key terms in both)`;
  }
  let dialectNote = "";
  if (p.language.primary === "ar" || p.language.secondary === "ar") {
    dialectNote = p.language.dialect === "saudi" ? "; for Arabic use a light Saudi dialect" : "; for Arabic use Modern Standard Arabic";
  }
  return { language, dialectNote };
}

/** Guardrails always come AFTER user-written personality text so it can never override them. */
export const GUARDRAILS =
  "ALWAYS: stay educational and age-appropriate; be honest when unsure; never invent citations or page numbers; " +
  "politely refuse harmful or inappropriate requests while staying in character. These rules override any personality or backstory text above.";
