import { estimateTokens } from "../text";

/**
 * "Whole book" must always mean the whole book. When a model can't take it in one prompt, the book
 * is read in consecutive parts (cut between pages) and the answers are combined — every page is
 * still read for every question.
 */

/** Largest prompt (provider tokens) a model accepts per request, as far as we know. */
export function modelLimit(model: string, smallWindow: number): number {
  if (model.startsWith("ollama:")) return smallWindow;
  if (/^gemma/.test(model)) return 16_000; // free tier: 16k input tokens per minute
  if (/^deepseek/.test(model)) return 1_000_000;
  return 1_048_576; // Gemini
}

/**
 * Our token estimate runs ~25% under real Arabic token counts (Gemini: 155,635 estimated vs
 * 194,840 counted for the biology book), so parts are sized to 70% of the limit, minus room for
 * the instructions, question and answer.
 */
export function partBudget(limit: number): number {
  return Math.max(800, Math.floor(limit * 0.7) - 800);
}

/** Split page-tagged book text ("[ص 12]\n…") into parts of at most `budget` estimated tokens, between pages. */
export function splitByPages(text: string, budget: number): string[] {
  const pages = text.split(/\n\n(?=\[)/);
  const parts: string[] = [];
  let cur = "", curTokens = 0;
  const flush = () => { if (cur.trim()) parts.push(cur); cur = ""; curTokens = 0; };
  for (const page of pages) {
    const t = estimateTokens(page);
    if (t > budget) {
      // A single page bigger than a part: cut it by characters.
      flush();
      const step = Math.max(200, Math.floor((page.length * budget) / t));
      for (let i = 0; i < page.length; i += step) parts.push(page.slice(i, i + step));
      continue;
    }
    if (curTokens + t > budget) flush();
    cur += (cur ? "\n\n" : "") + page;
    curTokens += t;
  }
  flush();
  return parts;
}

export const NOTHING_HERE = "لا شيء في هذا الجزء";

export function partPrompt(i: number, n: number): string {
  return `(هذا الجزء ${i + 1} من ${n} من الكتاب. إن لم يكن فيه ما يجيب عن السؤال فاكتب فقط: «${NOTHING_HERE}».)`;
}

export function combinePrompt(question: string, n: number, partial: string[]): string {
  return [
    `سؤال الطالب: ${question}`,
    `قُرئ الكتاب كاملًا على ${n} أجزاء. هذه إجابات الأجزاء التي وُجد فيها ما يتعلق بالسؤال:`,
    partial.length ? partial.join("\n\n---\n\n") : "(لم يوجد شيء في أي جزء)",
    "اكتب إجابة واحدة نهائية للطالب تجمع هذه المعلومات دون تكرار، مع أرقام الصفحات بالشكل [ص 45]. إن لم يوجد شيء فاكتب: «غير موجود في الكتاب».",
  ].join("\n\n");
}
