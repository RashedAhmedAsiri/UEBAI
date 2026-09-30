import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db";
import { buildContext, loadBook, SYSTEM_PROMPT, userPrompt } from "./context";
import { listDatasets } from "./runner";
import { countTokens } from "./llm";
import { citedPages, matchFacts, pageHit, repeatedShare } from "@/lib/bench/grade";
import type { Condition, RetrievalCell, RetrievalReport, RetrievalRow } from "@/lib/bench/types";

/**
 * Free retrieval check — no answers are generated, so it costs no AI quota and covers every
 * question. For each condition it asks: does the material the model would read CONTAIN the
 * answer (the answer key's facts and its page)? And how big is that material?
 *
 * Fairness: a fact only counts if it can be found in the whole-book text at all (PDF text is
 * sometimes garbled), so the whole book scores 100% by definition and the others are measured
 * against exactly the same findable facts.
 */

export const RETRIEVAL_CONDITIONS: Condition[] = ["uebai", "rag", "trunc", "full"];

/** Saved checks live apart from experiment runs: data/bench/retrieval/<question set>.json */
export const RETRIEVAL_DIR = path.join(DATA_DIR, "bench", "retrieval");

/** biology1.json → biology1.json (book only) or biology1-all-sources.json (whole library). */
export function retrievalFile(datasetFile: string, scope: RetrievalReport["scope"]) {
  const base = path.basename(datasetFile);
  return scope === "all_sources" ? base.replace(/\.json$/, "-all-sources.json") : base;
}

export function saveRetrieval(datasetFile: string, report: RetrievalReport) {
  fs.mkdirSync(RETRIEVAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(RETRIEVAL_DIR, retrievalFile(datasetFile, report.scope)), JSON.stringify(report));
}

export function savedRetrievals(): (RetrievalReport & { file: string })[] {
  if (!fs.existsSync(RETRIEVAL_DIR)) return [];
  return fs.readdirSync(RETRIEVAL_DIR).filter((f) => f.endsWith(".json")).flatMap((file) => {
    try { return [{ ...(JSON.parse(fs.readFileSync(path.join(RETRIEVAL_DIR, file), "utf8")) as RetrievalReport), file }]; } catch { return []; }
  });
}

export async function retrievalCheck(teacherId: string, datasetFile: string, smallWindow = 8192, exactModel: string | null = null, allSources = false): Promise<RetrievalReport> {
  const ds = listDatasets().find((d) => d.file === datasetFile);
  if (!ds) throw new Error("Question set not found");
  // allSources: the whole library (e.g. textbook + teacher's slides), not just the question set's book.
  const book = loadBook(teacherId, allSources ? undefined : ds.dataset.book_hint);
  const exact = async (material: string, q: string) => {
    if (!exactModel) return null;
    try { return await countTokens(exactModel, SYSTEM_PROMPT, userPrompt(material, q)); } catch { return null; }
  };

  const rows: RetrievalRow[] = [];
  for (const q of ds.dataset.questions) {
    const findable = matchFacts(book.fullText, q.facts);
    const cells = {} as Record<Condition, RetrievalCell>;
    for (const c of RETRIEVAL_CONDITIONS) {
      const ctx = buildContext(book, c, q.q, smallWindow);
      const found = matchFacts(ctx.material, q.facts);
      cells[c] = {
        tokens_est: ctx.tokens_est,
        // Exact counts for the two headline conditions (the whole book is the same for every question).
        tokens_exact: c === "uebai" ? await exact(ctx.material, q.q) : null,
        facts_found: found.filter((f, i) => f && findable[i]).length,
        facts_findable: findable.filter(Boolean).length,
        page_in_context: q.pages.length ? (c === "full" ? true : pageHit(citedPages(ctx.material), q.pages)) : null,
        topics: ctx.topics,
        repeated_share: c === "full" ? undefined : repeatedShare(ctx.material),
      };
    }
    rows.push({ question_id: q.id, category: q.category, q: q.q, pages: q.pages, cells });
  }
  const fullExact = await exact(book.fullText, ds.dataset.questions[0]?.q ?? "");
  for (const r of rows) r.cells.full.tokens_exact = fullExact;
  return {
    dataset: ds.dataset.name,
    scope: allSources ? "all_sources" : "book",
    book: { labels: book.info.labels, pages: book.info.pages, full_tokens_est: book.fullTokens, full_tokens_exact: fullExact, topics: book.info.topics },
    small_window: smallWindow,
    counted_with: exactModel,
    rows,
    at: new Date().toISOString(),
  };
}
