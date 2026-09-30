/** Shared (client + server) types for the proof benchmark ("Proof Lab"). */

/**
 * How the model gets the book:
 *  full  — the whole extracted book in the prompt (what people do today with long-context models)
 *  uebai — UEBAI: routed topic cards (Tier 2) + the top book passages (Tier 3)
 *  rag   — classic chunk retrieval: fixed 400-token pieces ranked by BM25, same token budget as uebai
 *  trunc — as much of the book as fits a small context window, from the start (a small model's view)
 */
export type Condition = "full" | "uebai" | "rag" | "trunc";
export const CONDITIONS: Condition[] = ["full", "uebai", "rag", "trunc"];

export type QuestionCategory = "fact" | "explain" | "multi" | "unanswerable";

export interface BenchQuestion {
  id: string;
  q: string;
  category: QuestionCategory;
  /** Reference answer written from the book (the answer key). */
  answer: string;
  /** Key facts a correct answer must contain; "a|b" means either spelling counts. */
  facts: string[];
  /** Book pages holding the answer (empty for unanswerable questions). */
  pages: number[];
}

export interface BenchDataset {
  name: string;
  /** Picks the book: the first ready source whose filename contains this. */
  book_hint?: string;
  protocol?: string;
  questions: BenchQuestion[];
}

export interface BenchConfig {
  teacher_id: string;
  dataset: string;
  question_ids: string[] | null;
  models: string[];
  conditions: Condition[];
  reps: number;
  judge_model: string | null;
  /** Context window for the "trunc" condition (and Ollama's num_ctx). */
  small_window: number;
  thinking: "low" | "high";
  max_output_tokens: number;
  /** Client-side pacing per model, so free-tier limits don't turn into errors mid-measurement. */
  rpm: number;
  tpm: number;
  /** Assumed list prices (USD per 1M tokens) for the cost estimate. Cached input (the provider's
   *  automatic prompt caching) is billed at the lower price_cached. */
  price_in: number;
  price_cached: number;
  price_out: number;
  seed: number;
}

export type ErrorKind = "too_large" | "quota_minute" | "quota_day" | "network" | "other";

export interface BenchCall {
  id: string;
  question_id: string;
  model: string;
  condition: Condition;
  rep: number;
  status: "ok" | "error";
  error?: string;
  error_kind?: ErrorKind;
  /** The model that actually answered, as reported by the API (no silent fallbacks). */
  model_version?: string;
  /** Building the context (routing, retrieval) — part of UEBAI's real cost, so it's in total_ms. */
  prep_ms: number;
  ttft_ms: number | null;
  total_ms: number | null;
  context_tokens_est: number;
  context_chars: number;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  thought_tokens: number | null;
  /** Ollama silently drops the start of prompts longer than num_ctx. */
  truncated?: boolean;
  /** Times the provider answered "busy / overloaded" before this measurement (retried, not timed). */
  busy_rejections?: number;
  /** Whole book read in this many parts (the model couldn't take it in one request) + 1 combining request. */
  parts?: number;
  answer: string;
  /** UEBAI: which topic cards the router opened. */
  topics?: string[];
  recall: number | null;
  cited_pages: number[];
  page_hit: boolean | null;
  abstained: boolean;
  correct_abstention: boolean | null;
  started_at: string;
}

export interface JudgeScore {
  correctness: number;
  completeness: number;
  faithfulness: number;
  /** Mean of the three, 0–10. */
  total: number;
  note: string;
}

export interface Judgment {
  question_id: string;
  model: string;
  rep: number;
  judge_model: string;
  /** Call ids in the (shuffled) order the judge saw them, labelled A, B, C… */
  order: string[];
  scores: Record<string, JudgeScore>;
  error?: string;
  at: string;
}

export interface HumanRating {
  rater: string;
  question_id: string;
  model: string;
  /** call id → 1..5 */
  scores: Record<string, number>;
  best: string | null;
  at: string;
}

export type RunStatus = "running" | "paused" | "done" | "failed" | "cancelled";

export interface BookInfo {
  source_ids: string[];
  labels: string[];
  pages: number;
  full_tokens_est: number;
  topics: number;
  cards_tokens: number;
  passages: number;
}

export interface BenchRun {
  id: string;
  created_at: string;
  updated_at: string;
  status: RunStatus;
  message: string;
  config: BenchConfig;
  dataset: BenchDataset;
  /** SHA-256 of the question-set file when the run started: proves the answer key wasn't edited after. */
  dataset_sha256?: string;
  book: BookInfo;
  /** Execution order, fixed at creation (shuffled so no condition always goes first). */
  plan: { question_id: string; model: string; condition: Condition; rep: number }[];
  calls: BenchCall[];
  /** Failed calls replaced by "Retry failed" (kept to report how often the provider refused). */
  retired?: BenchCall[];
  judgments: Judgment[];
  ratings: HumanRating[];
}

/** Free retrieval check (no answers generated): does each condition's material contain the answer? */
export interface RetrievalCell {
  tokens_est: number;
  /** Google's official count of the whole prompt (instructions + material + question), when requested. */
  tokens_exact: number | null;
  /** Answer-key facts found in the material, out of those findable anywhere in the whole book. */
  facts_found: number;
  facts_findable: number;
  page_in_context: boolean | null;
  topics?: string[];
  /** Share of the material that is repeated wording (see repeatedShare). */
  repeated_share?: number;
}

export interface RetrievalRow {
  question_id: string;
  category: QuestionCategory;
  q: string;
  pages: number[];
  cells: Record<Condition, RetrievalCell>;
}

export interface RetrievalReport {
  dataset: string;
  /** Which of the teacher's sources were used (all of them, or only the question set's book). */
  scope?: "book" | "all_sources";
  book: { labels: string[]; pages: number; full_tokens_est: number; full_tokens_exact: number | null; topics: number };
  small_window: number;
  counted_with: string | null;
  rows: RetrievalRow[];
  at: string;
}

/** List view. */
export interface RunSummary {
  id: string;
  created_at: string;
  status: RunStatus;
  message: string;
  dataset: string;
  models: string[];
  conditions: Condition[];
  done: number;
  total: number;
}
