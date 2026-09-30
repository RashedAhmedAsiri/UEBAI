/**
 * Deterministic answer grading for the benchmark (no AI involved, so anyone can re-check it):
 *  - key-fact recall: share of the answer key's facts that appear in the answer
 *  - page citations: which pages the answer cites, and whether one of them is a correct page
 *  - abstention: whether the answer says "not in the book" (right for unanswerable questions,
 *    wrong otherwise)
 */

/** Normalizes Arabic/English text for fact matching: letter forms, diacritics, digits, spacing. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKC") // Arabic presentation forms from PDFs → normal letters
    .toLowerCase()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/ـ/g, "") // tatweel
    .replace(/[ً-ٰٟۖ-ۭ]/g, "") // tashkeel
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/(\d)[٫](\d)/g, "$1.$2") // Arabic decimal separator
    .replace(/٪/g, "%")
    .replace(/(\d)[,٬‚'’\s](?=\d{3}\b)/g, "$1") // thousands separators: 200,000 → 200000
    .replace(/[^\p{L}\p{N}.%\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// PDFs often reverse the lam-alef ligature ("البالزموديوم" for "البلازموديوم"); answers built from that
// text may copy the spelling. Folding "لا"→"ال" on both sides scores the content, for every condition alike.
const foldLamAlef = (s: string) => s.replace(/لا/g, "ال");

/** A fact is "a|b|c": any alternative counts. Returns which facts were found. */
export function matchFacts(answer: string, facts: string[]): boolean[] {
  const a = ` ${foldLamAlef(normalizeAnswer(answer))} `;
  return facts.map((f) => f.split("|").map((alt) => foldLamAlef(normalizeAnswer(alt))).filter(Boolean).some((alt) => a.includes(alt)));
}

export function factRecall(answer: string, facts: string[]): number | null {
  if (!facts.length) return null;
  const hits = matchFacts(answer, facts);
  return hits.filter(Boolean).length / facts.length;
}

/**
 * How much of a text repeats itself: 1 − (distinct 6-word runs ÷ all 6-word runs), after
 * normalization and without page tags. 0 = no repeated wording; 0.3 = 30% of the text is repeats
 * (e.g. the same sentence arriving once from the textbook and again from the slides).
 */
export function repeatedShare(text: string, n = 6): number {
  const words = foldLamAlef(normalizeAnswer(text.replace(/\[[^\]]*\]/g, " "))).split(" ").filter((w) => w.length > 1);
  if (words.length < n * 2) return 0;
  const seen = new Set<string>();
  let total = 0;
  for (let i = 0; i + n <= words.length; i++) {
    seen.add(words.slice(i, i + n).join(" "));
    total++;
  }
  return 1 - seen.size / total;
}

/** Pages the answer cites: [ص 45], ص.45, صفحة ٤٥, [p.45], ranges like ص 45-47. */
export function citedPages(answer: string): number[] {
  const text = answer.normalize("NFKC").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  const out = new Set<number>();
  const re = /(?:ص\s*\.?|صفحة|صفحه|الصفحة|الصفحات|صفحات|\bp\.?|\bpages?)\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/gi;
  for (const m of text.matchAll(re)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b >= a && b - a <= 10) for (let p = a; p <= b; p++) out.add(p);
    else out.add(a);
  }
  return [...out].sort((x, y) => x - y);
}

/** True if any cited page is within ±tolerance of an expected page; null if the key has no pages. */
export function pageHit(cited: number[], expected: number[], tolerance = 1): boolean | null {
  if (!expected.length) return null;
  return cited.some((c) => expected.some((e) => Math.abs(c - e) <= tolerance));
}

// "Not in the book" must mention the material, so content like "flatworms have no lungs" doesn't count.
const MATERIAL = "(?:ال)?(?:كتاب|مادة|ماده|نص|مرجع|مصدر|مرفق|مقدم|سياق)";
const ABSTAIN = [
  new RegExp(`غير (?:موجود|مذكور|متوفر|وارد)ة? (?:في|ب)\\s?${MATERIAL}`),
  new RegExp(`(?:لم (?:يرد|يُذكر|يذكر|ترد|تذكر|أجد|اجد|يتطرق|يتناول)|لا (?:يوجد|توجد|يتضمن|تتضمن|يحتوي|تحتوي|يذكر|تذكر|يتناول|تتناول|يتطرق)|ليس(?:ت)? (?:موجود|مذكور))[^.؟!\\n]{0,80}${MATERIAL}`),
  /not (?:found|mentioned|covered|included)[^.\n]{0,60}(?:book|text|material|context)/i,
];

/** Did the answer (partly) decline because the material doesn't cover the question? */
export function abstained(answer: string): boolean {
  const t = answer.normalize("NFKC").replace(/[ً-ٰٟ]/g, "");
  return ABSTAIN.some((re) => re.test(t));
}

export interface Grade {
  recall: number | null;
  cited_pages: number[];
  page_hit: boolean | null;
  abstained: boolean;
  /** Unanswerable questions only: did it correctly say "not in the book" instead of inventing? */
  correct_abstention: boolean | null;
}

export function gradeAnswer(answer: string, q: { facts: string[]; pages: number[]; category: string }): Grade {
  const cited = citedPages(answer);
  const abst = abstained(answer);
  const unanswerable = q.category === "unanswerable";
  return {
    recall: unanswerable ? null : factRecall(answer, q.facts),
    cited_pages: cited,
    page_hit: unanswerable ? null : pageHit(cited, q.pages),
    abstained: abst,
    correct_abstention: unanswerable ? abst : null,
  };
}
