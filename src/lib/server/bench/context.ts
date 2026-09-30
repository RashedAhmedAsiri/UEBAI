import "server-only";
import { db } from "../db";
import { keywordRoute, readyTopics, searchPassages } from "../answer";
import { Bm25, estimateTokens } from "@/lib/text";
import type { BookInfo, Condition } from "@/lib/bench/types";
import type { Source, Teacher } from "@/lib/types";

/**
 * Builds what the model reads under each benchmark condition. Every condition gets the SAME
 * instructions and question; only the book material differs. All text is NFKC-normalized
 * (PDFs often store Arabic as presentation-form glyphs), for every condition alike.
 */

export const SYSTEM_PROMPT = [
  "أنت مساعد تعليمي يجيب طالبًا في المرحلة الثانوية.",
  "- أجب اعتمادًا على «المادة المرجعية» المرفقة فقط، ولا تستخدم معلومات من خارجها.",
  "- اذكر رقم الصفحة بعد كل معلومة بهذا الشكل: [ص 45].",
  "- إن لم تجد الإجابة في المادة المرجعية فاكتب: «غير موجود في الكتاب» ولا تخمّن.",
  "- اكتب بالعربية الفصحى، بإيجاز ووضوح، في ١٨٠ كلمة على الأكثر.",
].join("\n");

export function userPrompt(material: string, question: string) {
  return `<المادة_المرجعية>\n${material}\n</المادة_المرجعية>\n\nسؤال الطالب: ${question}`;
}

const nfkc = (s: string) => s.normalize("NFKC");

interface Chunk { id: string; text: string; tokens: number }
export interface Book {
  teacher: Teacher;
  sources: Source[];
  fullText: string;
  fullTokens: number;
  pages: number;
  chunks: Chunk[];
  chunkIndex: Bm25;
  avgChunkTokens: number;
  info: BookInfo;
}

type G = typeof globalThis & { __uebaiBenchBooks?: Map<string, Book> };
const cache: Map<string, Book> = ((globalThis as G).__uebaiBenchBooks ??= new Map());

const CHUNK_TOKENS = 400;

/** The teacher's ready books as one page-marked text, plus a classic chunk index for the RAG baseline. */
export function loadBook(teacherId: string, hint?: string): Book {
  const d = db();
  const teacher = d.teachers.find((t) => t.id === teacherId);
  if (!teacher) throw new Error("Teacher not found");
  let sources = d.sources.filter((s) => s.teacher_id === teacherId && s.status === "ready");
  if (hint && sources.some((s) => s.filename.includes(hint))) sources = sources.filter((s) => s.filename.includes(hint));
  if (!sources.length) throw new Error("This teacher has no ready books yet");
  const ids = new Set(sources.map((s) => s.id));
  const paras = d.paragraphs.filter((p) => ids.has(p.source_id));
  const topics = readyTopics(teacherId);
  const key = `${teacherId}|${[...ids].join(",")}|${paras.length}|${d.passages.length}|${topics.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const multi = sources.length > 1;
  const pageTag = (s: Source, page: number) => (multi ? `[${s.label} ص ${page}]` : `[ص ${page}]`);
  const parts: string[] = [];
  const chunks: Chunk[] = [];
  let pageCount = 0;
  for (const s of sources) {
    const mine = paras.filter((p) => p.source_id === s.id).sort((a, b) => a.page - b.page || a.idx - b.idx);
    const byPage = new Map<number, string[]>();
    for (const p of mine) byPage.set(p.page, [...(byPage.get(p.page) ?? []), nfkc(p.text)]);
    pageCount += byPage.size;
    // Classic RAG chunks: ~400 tokens of consecutive text, with the page tag where each page starts.
    let buf = "", bufTokens = 0;
    const flush = () => { if (buf.trim()) chunks.push({ id: String(chunks.length), text: buf.trim(), tokens: bufTokens }); buf = ""; bufTokens = 0; };
    for (const [page, texts] of byPage) {
      parts.push(`${pageTag(s, page)}\n${texts.join("\n")}`);
      buf += `\n${pageTag(s, page)}\n`;
      for (const t of texts) {
        const tt = estimateTokens(t);
        if (bufTokens + tt > CHUNK_TOKENS && bufTokens > CHUNK_TOKENS / 2) { flush(); buf = `${pageTag(s, page)}\n`; }
        buf += t + "\n";
        bufTokens += tt;
      }
    }
    flush();
  }
  const fullText = parts.join("\n\n");
  const fullTokens = estimateTokens(fullText);
  const book: Book = {
    teacher, sources, fullText, fullTokens, pages: pageCount, chunks,
    chunkIndex: new Bm25(chunks.map((c) => ({ id: c.id, text: c.text }))),
    avgChunkTokens: chunks.reduce((n, c) => n + c.tokens, 0) / Math.max(1, chunks.length),
    info: {
      source_ids: sources.map((s) => s.id), labels: sources.map((s) => s.label), pages: pageCount, full_tokens_est: fullTokens,
      topics: topics.length, cards_tokens: topics.reduce((n, t) => n + t.notes_tokens, 0),
      passages: d.passages.filter((p) => ids.has(p.source_id)).length,
    },
  };
  cache.set(key, book);
  return book;
}

/** "[Biology 1 ص.28]" / "[Biology 1 p.28]" → "[ص 28]", the same citation style as the full-book condition. */
function plainRefs(notes: string, multi: boolean): string {
  if (multi) return notes;
  return notes.replace(/\[[^\]]*?(?:ص\.?|p\.)\s?(\d+(?:\s*[-–]\s*\d+)?)\]/g, "[ص $1]");
}

export interface BuiltContext {
  material: string;
  prep_ms: number;
  tokens_est: number;
  topics?: string[];
}

const PASSAGES_K = 3;

/** UEBAI: the topic cards the router opens (Tier 2) + the best matching book passages (Tier 3). */
export function uebaiContext(book: Book, question: string): BuiltContext {
  const t0 = performance.now();
  const topics = readyTopics(book.teacher.id);
  const chosen = keywordRoute(book.teacher.id, topics, question).map((id) => topics.find((t) => t.id === id)!);
  const multi = book.sources.length > 1;
  const labels = new Map(book.sources.map((s) => [s.id, s.label]));
  const passages = searchPassages(book.teacher.id, question, undefined, PASSAGES_K);
  const cards = chosen.map((t) => `### بطاقة الموضوع: ${t.title}\n${plainRefs(nfkc(t.notes_md), multi)}`);
  const quotes = passages.map((p) => {
    const pages = p.page_start === p.page_end ? `${p.page_start}` : `${p.page_start}-${p.page_end}`;
    return `${multi ? `[${labels.get(p.source_id)} ص ${pages}]` : `[ص ${pages}]`}\n${nfkc(p.text)}`;
  });
  const material = [...cards, ...(quotes.length ? [`### مقاطع من نص الكتاب\n${quotes.join("\n\n")}`] : [])].join("\n\n");
  return { material, prep_ms: performance.now() - t0, tokens_est: estimateTokens(material), topics: chosen.map((t) => t.title) };
}

/** Whole book, as people use long-context models today. */
export function fullContext(book: Book): BuiltContext {
  return { material: book.fullText, prep_ms: 0, tokens_est: book.fullTokens };
}

/** Classic chunk RAG with the same token budget UEBAI used for this question. */
export function ragContext(book: Book, question: string, budgetTokens: number): BuiltContext {
  const t0 = performance.now();
  const k = Math.max(1, Math.round(budgetTokens / book.avgChunkTokens));
  const byId = new Map(book.chunks.map((c) => [c.id, c]));
  const hits = book.chunkIndex.search(question, k).map((h) => byId.get(h.id)!);
  // Keep book order so page tags read naturally.
  hits.sort((a, b) => Number(a.id) - Number(b.id));
  const material = hits.map((c) => c.text).join("\n\n…\n\n");
  return { material, prep_ms: performance.now() - t0, tokens_est: estimateTokens(material) };
}

/** A small-context model's view: as much of the book as fits, from the first page. */
export function truncContext(book: Book, windowTokens: number): BuiltContext {
  const budget = Math.max(500, windowTokens - 600); // room for instructions, question and answer
  if (book.fullTokens <= budget) return fullContext(book);
  let lo = 0, hi = book.fullText.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (estimateTokens(book.fullText.slice(0, mid)) <= budget) lo = mid; else hi = mid - 1;
  }
  const material = book.fullText.slice(0, lo);
  return { material, prep_ms: 0, tokens_est: estimateTokens(material) };
}

export function buildContext(book: Book, condition: Condition, question: string, smallWindow: number): BuiltContext {
  switch (condition) {
    case "full": return fullContext(book);
    case "uebai": return uebaiContext(book, question);
    case "rag": {
      const u = uebaiContext(book, question); // budget only; not timed as part of RAG
      const r = ragContext(book, question, u.tokens_est);
      return r;
    }
    case "trunc": return truncContext(book, smallWindow);
  }
}
