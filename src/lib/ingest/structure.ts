/** Pure cleaning + structural splitting (testable without the server). */
import { estimateTokens, hashNormalized, normalizeForSearch, repairPdfArabic } from "../text";

export interface PageText { page: number; text: string }

export interface RawParagraph {
  idx: number; // global, 1-based: [¶idx]
  page: number;
  text: string;
  heading: string | null; // nearest heading path, e.g. "Unit 3 › Mammals"
  norm_hash: string;
}

export interface Section {
  title: string;
  unit: string | null;
  paragraphs: RawParagraph[];
}

/** Strip repeated running headers/footers & page numbers, fix hyphenation, normalize whitespace. */
export function cleanPages(pages: PageText[]): PageText[] {
  const edgeCounts = new Map<string, number>();
  const edgeKey = (l: string) => normalizeForSearch(l).replace(/\d+/g, "#");
  const splitLines = pages.map((p) => repairPdfArabic(p.text).replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()));
  for (const lines of splitLines) {
    const nonEmpty = lines.filter(Boolean);
    const edges = new Set([...nonEmpty.slice(0, 2), ...nonEmpty.slice(-2)].map(edgeKey).filter(Boolean));
    for (const e of edges) edgeCounts.set(e, (edgeCounts.get(e) ?? 0) + 1);
  }
  const threshold = Math.max(3, pages.length * 0.4);
  const repeated = new Set([...edgeCounts].filter(([, n]) => n >= threshold).map(([k]) => k));

  return pages.map((p, i) => {
    const lines = splitLines[i].filter((l) => {
      if (!l) return true;
      if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(l)) return false; // bare page numbers
      if (/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(l)) return false;
      return !(pages.length >= 5 && repeated.has(edgeKey(l)) && l.length < 120);
    });
    const text = lines
      .join("\n")
      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2") // de-hyphenate line breaks
      .replace(/\n{3,}/g, "\n\n");
    return { page: p.page, text };
  });
}

// `\b` is ASCII-only in JS, so use an explicit lookahead that also works after Arabic words.
const HEADING_WORD = /^(chapter|unit|section|lesson|part|module|topic|الفصل|الوحدة|الدرس|الباب|المبحث)(?=[\s:.\-–]|$)/i;

export function headingLevel(line: string): number | null {
  const l = line.trim();
  const md = l.match(/^(#{1,6})\s+\S/);
  if (md) return md[1].length;
  if (l.length < 3 || l.length > 90) return null;
  if (/[.,;:،؛]$/.test(l) || /^[-•*]/.test(l)) return null;
  const words = l.split(/\s+/);
  if (words.length > 12) return null;
  if (!/\p{L}/u.test(l)) return null;
  if (HEADING_WORD.test(l)) return 1;
  const numbered = l.match(/^(\d+(?:\.\d+){0,3})\.?\s+\p{L}/u);
  if (numbered) return numbered[1].split(".").length;
  const letters = l.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 4 && letters === letters.toUpperCase() && /[A-Z]/.test(letters) && words.length <= 8) return 2;
  const latinWords = words.filter((w) => /^[A-Za-z]/.test(w));
  if (latinWords.length >= 2 && words.length <= 8) {
    const titled = latinWords.filter((w) => /^[A-Z]/.test(w) || /^(of|and|the|in|on|for|to|a|an|vs)$/.test(w)).length;
    if (titled === latinWords.length) return 3;
  }
  return null;
}

/** Turn pages into numbered paragraphs, tracking headings. */
export function toParagraphs(pages: PageText[], startIdx = 1): { paragraphs: RawParagraph[]; headings: { idx: number; level: number; text: string }[] } {
  const paragraphs: RawParagraph[] = [];
  const headings: { idx: number; level: number; text: string }[] = [];
  const stack: { level: number; text: string }[] = [];
  let idx = startIdx;
  let buf = "", bufPage = 1;

  const flush = () => {
    const text = buf.replace(/\s+/g, " ").trim();
    buf = "";
    if (text.length < 25 && !/\p{L}{3}/u.test(text)) return;
    if (!text) return;
    paragraphs.push({ idx: idx++, page: bufPage, text, heading: stack.map((s) => s.text).join(" › ") || null, norm_hash: hashNormalized(text) });
  };

  for (const p of pages) {
    const lines = p.text.split("\n");
    const lens = lines.map((l) => l.trim().length).filter((n) => n > 0);
    const typical = lens.length ? lens.sort((a, b) => a - b)[Math.floor(lens.length * 0.75)] : 80;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const lvl = headingLevel(line);
      if (lvl !== null) {
        flush();
        const text = line.replace(/^#+\s*/, "");
        while (stack.length && stack[stack.length - 1].level >= lvl) stack.pop();
        stack.push({ level: lvl, text });
        headings.push({ idx, level: lvl, text });
        continue;
      }
      if (!buf) bufPage = p.page;
      buf += (buf ? " " : "") + line;
      const endsSentence = /[.!?؟:)"”]$/.test(line);
      if (/^[-•*]\s/.test(line) || (endsSentence && line.length < typical * 0.8) || buf.length > 1400) flush();
    }
    // Paragraphs may continue across pages; keep buffer unless it ended a sentence.
    if (/[.!?؟]$/.test(buf.trim())) flush();
  }
  flush();
  return { paragraphs, headings };
}

/**
 * Cut paragraphs into sections using heading levels; unit = top-level heading.
 * If there is no structure, use ~1,500-token windows with 10% overlap.
 */
export function toSections(paragraphs: RawParagraph[], fallbackUnit: string): Section[] {
  const hasHeadings = paragraphs.some((p) => p.heading);
  const sections: Section[] = [];
  if (hasHeadings) {
    let cur: Section | null = null;
    for (const p of paragraphs) {
      const path = p.heading?.split(" › ") ?? [];
      const title = path[path.length - 1] ?? fallbackUnit;
      const unit = path.length > 1 ? path[0] : null;
      if (!cur || cur.title !== title || cur.unit !== unit || sectionTokens(cur) > 2500) {
        cur = { title, unit, paragraphs: [] };
        sections.push(cur);
      }
      cur.paragraphs.push(p);
    }
    return sections;
  }
  const WINDOW = 1500;
  let i = 0;
  while (i < paragraphs.length) {
    const s: Section = { title: fallbackUnit, unit: null, paragraphs: [] };
    let tokens = 0, j = i;
    while (j < paragraphs.length && (tokens < WINDOW || s.paragraphs.length === 0)) {
      tokens += estimateTokens(paragraphs[j].text);
      s.paragraphs.push(paragraphs[j++]);
    }
    sections.push(s);
    if (j >= paragraphs.length) break;
    const overlap = Math.max(1, Math.floor(s.paragraphs.length * 0.1));
    i = Math.max(i + 1, j - overlap);
  }
  return sections;
}

export function sectionTokens(s: Section) {
  return s.paragraphs.reduce((n, p) => n + estimateTokens(p.text), 0);
}

/** Render a section for the topic-detection prompt: [¶N] numbering + [p.N] markers. */
export function renderSection(s: Section): string {
  let lastPage = -1;
  const out: string[] = [`# ${s.unit ? s.unit + " › " : ""}${s.title}`];
  for (const p of s.paragraphs) {
    if (p.page !== lastPage) { out.push(`[p.${p.page}]`); lastPage = p.page; }
    out.push(`[¶${p.idx}] ${p.text}`);
  }
  return out.join("\n");
}

/** Chunk paragraphs into 300–500 token passages, keeping page ranges. */
export function chunkPassages<P extends { page: number; text: string }>(paras: P[], min = 300, max = 500): { text: string; page_start: number; page_end: number; tokens: number }[] {
  const out: { text: string; page_start: number; page_end: number; tokens: number }[] = [];
  let cur: P[] = [], tokens = 0;
  const push = () => {
    if (!cur.length) return;
    out.push({ text: cur.map((p) => p.text).join("\n\n"), page_start: cur[0].page, page_end: cur[cur.length - 1].page, tokens });
    cur = []; tokens = 0;
  };
  for (const p of paras) {
    const t = estimateTokens(p.text);
    if (tokens + t > max && tokens >= min) push();
    cur.push(p); tokens += t;
  }
  // Fold a tiny tail into the previous passage.
  if (cur.length && tokens < min / 2 && out.length) {
    const last = out[out.length - 1];
    last.text += "\n\n" + cur.map((p) => p.text).join("\n\n");
    last.page_end = cur[cur.length - 1].page;
    last.tokens += tokens;
  } else push();
  return out;
}
