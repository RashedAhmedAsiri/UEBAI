/** Pure text utilities shared by ingestion, retrieval and tests. */

const ARABIC_RE = /[؀-ۿ]/;

/** Rough token estimate: ~4 chars/token for Latin, ~2.5 for Arabic script. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let arabic = 0;
  for (const ch of text) if (ARABIC_RE.test(ch)) arabic++;
  const other = text.length - arabic;
  return Math.ceil(other / 4 + arabic / 2.5);
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BRACKETED_IDS = new RegExp(`\\s*[\\[(]\\s*(?:id\\s*[:=]\\s*)?${UUID}(?:\\s*[,;،]\\s*${UUID})*\\s*[\\])]`, "gi");
const BARE_ID = new RegExp(`\\b${UUID}\\b`, "gi");

/** Removes Arabic diacritics (tashkeel), e.g. for matching "الأَحْيَاء" against "الأحياء". */
export function stripTashkeel(text: string): string {
  return text.replace(/[ً-ٰٟۖ-ۭ]/g, "");
}

/** Removes internal topic ids the model sometimes echoes into replies, e.g. "[4783dbbb-…]". */
export function stripInternalIds(text: string): string {
  return text.replace(BRACKETED_IDS, "").replace(BARE_ID, "");
}

/**
 * Repairs Arabic text as PDF extractors commonly return it:
 *  - presentation-form glyphs (ﻗــﺎرن) → normal letters (قــارن), via NFKC; without this, search
 *    and topic matching never see those words
 *  - the lam-alef ligature read in reverse ("األرض" for "الأرض", "االنتشار" for "الانتشار"): only
 *    letter sequences that never occur in correct Arabic are fixed, so nothing valid is changed.
 * Words where both spellings are valid ("خاليا"/"خلايا") are left for the note writer to correct.
 */
export function repairPdfArabic(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/ا([أإآ])ل/g, "ال$1")
    .replace(/اال/g, "الا")
    .replace(/(^|[\s(«"])إال(?=$|[\s.,،؛:)»"])/g, "$1إلا");
}

export function detectLanguage(text: string): "ar" | "en" {
  const sample = text.slice(0, 4000);
  let arabic = 0, latin = 0;
  for (const ch of sample) {
    if (ARABIC_RE.test(ch)) arabic++;
    else if (/[a-zA-Z]/.test(ch)) latin++;
  }
  return arabic > latin ? "ar" : "en";
}

/** Normalization for SEARCH fields only (display text keeps the original). */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ـ/g, "") // tatweel
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(
  (
    "the a an and or of to in on for is are was were be been by with as at from that this these those it its " +
    "into than then there their which what who whom how why when where can could should would may might will " +
    "do does did not no yes but if so such also about over under between each other more most some any all " +
    "في من على إلى الى عن مع هذا هذه ذلك التي الذي الذين هو هي هم كان كانت يكون او أو ثم لا ما لم لن قد كل بين عند"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return normalizeForSearch(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Very light English stemmer (plural/verb endings) + Arabic "ال" prefix strip. */
function stem(w: string): string {
  if (/^[a-z]+$/.test(w)) {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 4 && w.endsWith("es") && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    return w;
  }
  if (w.length > 4 && w.startsWith("ال")) return w.slice(2);
  return w;
}

export function hashNormalized(text: string): string {
  // FNV-1a 64-bit on normalized text; used for exact paragraph dedup.
  const s = normalizeForSearch(text);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function trigrams(s: string): Set<string> {
  const t = ` ${normalizeForSearch(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Trigram Jaccard similarity in [0,1] (pg_trgm-style). */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Cosine similarity of term-frequency vectors (stand-in for embeddings, fully local). */
export function cosineSimilarity(a: string, b: string): number {
  const va = termFreq(tokenize(a)), vb = termFreq(tokenize(b));
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of va) { na += v * v; const w = vb.get(k); if (w) dot += v * w; }
  for (const v of vb.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function termFreq(tokens: string[]) {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/**
 * Topic-identity similarity used by canonicalization: blends title/alias trigram
 * overlap (catches "Mammals" vs "Class Mammalia") with description term cosine.
 */
export function topicSimilarity(
  a: { title: string; aliases: string[]; description: string },
  b: { title: string; aliases: string[]; description: string },
): number {
  const namesA = [a.title, ...a.aliases], namesB = [b.title, ...b.aliases];
  let nameSim = 0;
  for (const x of namesA) for (const y of namesB) {
    const nx = normalizeForSearch(x), ny = normalizeForSearch(y);
    if (nx && nx === ny) nameSim = 1;
    else nameSim = Math.max(nameSim, trigramSimilarity(x, y));
  }
  const descSim = cosineSimilarity(`${a.title} ${a.description}`, `${b.title} ${b.description}`);
  return Math.min(1, 0.7 * nameSim + 0.3 * descSim + (nameSim === 1 ? 0.3 : 0));
}

export interface Bm25Doc { id: string; text: string }

/** Small in-memory BM25 index. */
export class Bm25 {
  private docs: { id: string; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  constructor(docs: Bm25Doc[], private k1 = 1.4, private b = 0.75) {
    let total = 0;
    for (const d of docs) {
      const toks = tokenize(d.text);
      const tf = termFreq(toks);
      for (const k of tf.keys()) this.df.set(k, (this.df.get(k) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len: toks.length });
      total += toks.length;
    }
    this.avgLen = docs.length ? total / docs.length : 0;
  }
  search(query: string, k = 8): { id: string; score: number }[] {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const scored = this.docs.map((d) => {
      let s = 0;
      for (const term of q) {
        const f = d.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / (this.avgLen || 1))));
      }
      return { id: d.id, score: s };
    });
    return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** Pull the first JSON object/array out of an LLM reply (tolerates code fences / prose). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = body[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1)) as T;
  }
  throw new Error("Unterminated JSON in model output");
}

export function slugify(s: string) {
  return normalizeForSearch(s).replace(/\s+/g, "-").slice(0, 60) || "topic";
}

/** Split text into sentences (Latin + Arabic punctuation). */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?؟。])\s+/).map((s) => s.trim()).filter(Boolean);
}
