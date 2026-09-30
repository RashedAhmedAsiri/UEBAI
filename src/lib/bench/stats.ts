/**
 * Statistics for the benchmark report. Pure functions (used by the report page, the CLI and tests).
 * Comparisons are PAIRED by question: every question is answered under every condition, so we
 * compare each question with itself and test the per-question differences (sign-flip permutation
 * test — no normality assumption, fine for small samples).
 */
import type { BenchCall, BenchRun, Condition, QuestionCategory, RetrievalReport } from "./types";

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// Two-sided 97.5% t quantiles for df = 1..30 (then ≈ normal).
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/** 95% confidence interval of the mean (t distribution). */
export function ci95(xs: number[]): [number, number] {
  const n = xs.length;
  if (n < 2) return [mean(xs), mean(xs)];
  const t = n - 1 <= 30 ? T975[n - 2] : 1.96;
  const h = (t * std(xs)) / Math.sqrt(n);
  return [mean(xs) - h, mean(xs) + h];
}

/** Small deterministic PRNG (mulberry32) so shuffles and tests are reproducible. */
export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** String → 32-bit seed (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Two-sided paired permutation (sign-flip) test on per-question differences.
 * Exact for n ≤ 16, otherwise 20,000 random flips. Returns the p-value.
 */
export function signFlipP(diffs: number[], seed = 1): number {
  const d = diffs.filter((x) => Number.isFinite(x));
  const n = d.length;
  if (!n) return NaN;
  const observed = Math.abs(d.reduce((a, b) => a + b, 0));
  if (observed === 0) return 1;
  let extreme = 0, total = 0;
  const eps = 1e-9 * (1 + observed);
  if (n <= 16) {
    for (let mask = 0; mask < 1 << n; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += mask & (1 << i) ? -d[i] : d[i];
      if (Math.abs(s) >= observed - eps) extreme++;
      total++;
    }
  } else {
    const rand = rng(seed);
    total = 20000;
    for (let k = 0; k < total; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += rand() < 0.5 ? -d[i] : d[i];
      if (Math.abs(s) >= observed - eps) extreme++;
    }
  }
  return extreme / total;
}

// ── Report aggregation ────────────────────────────────────────────────────

export interface Metric { n: number; mean: number; median: number; std: number; ci: [number, number] }
export function metric(xs: (number | null | undefined)[]): Metric {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return { n: v.length, mean: mean(v), median: median(v), std: std(v), ci: ci95(v) };
}

/** Per-question value for one model+condition, averaged over repetitions. */
type PerQ = Map<string, number>;

export interface CellSummary {
  model: string;
  condition: Condition;
  calls: number;
  errors: number;
  error_kinds: Record<string, number>;
  ttft_ms: Metric;
  total_ms: Metric;
  input_tokens: Metric;
  output_tokens: Metric;
  cost_per_1000: number;
  recall: Metric;
  page_hit_rate: number;
  /** Unanswerable questions: share where it correctly said "not in the book". */
  abstention_rate: number;
  /** Answerable questions where it wrongly said "not in the book" and got no fact right. */
  false_abstention_rate: number;
  judge: Metric;
  human: Metric;
  human_best_share: number;
  /** Requests the provider refused as "busy / overloaded", out of all requests sent (retries included). */
  refused: number;
  sent: number;
  refused_rate: number;
  by_category: Partial<Record<QuestionCategory, { recall: Metric; judge: Metric }>>;
}

export interface Comparison {
  model: string;
  a: Condition; // UEBAI
  b: Condition; // the other condition
  metric: "total_ms" | "ttft_ms" | "input_tokens" | "recall" | "judge";
  n: number;
  mean_a: number;
  mean_b: number;
  /** Mean of per-question (a − b). */
  mean_diff: number;
  diff_ci: [number, number];
  /** For times/tokens: median of per-question b / a (how many times faster/cheaper UEBAI is). */
  ratio_median: number | null;
  wins: number; ties: number; losses: number;
  p: number;
  /**
   * Quality measures only: is UEBAI proven "not worse" than the other condition by more than the
   * pre-declared margin (lower end of the 95% CI of the difference above the margin)? null when it
   * doesn't apply or there are fewer than 5 questions.
   */
  non_inferior: boolean | null;
}

/** Pre-declared non-inferiority margins: at most 10 points of key-fact recall, 1 point of judge score (/10). */
export const NI_MARGIN = { recall: -0.1, judge: -1 } as const;

const ok = (c: BenchCall) => c.status === "ok";

/**
 * Published list prices (USD per 1M tokens) for models whose price we know; other models use the
 * run's assumed prices. DeepSeek: peak-hour prices from api-docs.deepseek.com (off-peak is half).
 */
const KNOWN_PRICES: [RegExp, { in: number; cached: number; out: number }][] = [
  [/^deepseek-flash/, { in: 0.3, cached: 0.006, out: 1.2 }],
  [/^deepseek-v4-pro/, { in: 1.32, cached: 0.044, out: 3.96 }],
];

export function priceFor(model: string, cfg: { price_in: number; price_out: number; price_cached?: number }) {
  return KNOWN_PRICES.find(([re]) => re.test(model))?.[1] ?? { in: cfg.price_in, cached: cfg.price_cached ?? cfg.price_in, out: cfg.price_out };
}

/** USD for one call. Cached input tokens (automatic prompt caching) are billed at the cached price. */
export function callCost(c: BenchCall, cfg: { price_in: number; price_out: number; price_cached?: number }): number {
  const p = priceFor(c.model, cfg);
  const cached = Math.min(c.cached_tokens ?? 0, c.input_tokens ?? 0);
  const fresh = (c.input_tokens ?? 0) - cached;
  const out = (c.output_tokens ?? 0) + (c.thought_tokens ?? 0);
  return (fresh * p.in + cached * p.cached + out * p.out) / 1e6;
}

export function summarize(run: BenchRun) {
  const qById = new Map(run.dataset.questions.map((q) => [q.id, q]));
  const judgeByCall = new Map<string, number>();
  for (const j of run.judgments) for (const [id, s] of Object.entries(j.scores)) judgeByCall.set(id, s.total);
  const humanByCall = new Map<string, number[]>();
  const bestCount = new Map<string, number>();
  for (const r of run.ratings) {
    for (const [id, s] of Object.entries(r.scores)) humanByCall.set(id, [...(humanByCall.get(id) ?? []), s]);
    if (r.best) bestCount.set(r.best, (bestCount.get(r.best) ?? 0) + 1);
  }
  const ratedQuestions = run.ratings.length;

  const cells: CellSummary[] = [];
  const perQ = new Map<string, Record<string, PerQ>>(); // `${model}|${cond}` → metric → question → value

  for (const model of run.config.models) {
    for (const condition of run.config.conditions) {
      const calls = run.calls.filter((c) => c.model === model && c.condition === condition);
      const good = calls.filter(ok);
      const kinds: Record<string, number> = {};
      for (const c of calls) if (c.status === "error") kinds[c.error_kind ?? "other"] = (kinds[c.error_kind ?? "other"] ?? 0) + 1;

      const byQ = (f: (c: BenchCall) => number | null | undefined): PerQ => {
        const m = new Map<string, number[]>();
        for (const c of good) { const v = f(c); if (typeof v === "number" && Number.isFinite(v)) m.set(c.question_id, [...(m.get(c.question_id) ?? []), v]); }
        return new Map([...m].map(([k, v]) => [k, mean(v)]));
      };
      const q = {
        total_ms: byQ((c) => c.total_ms),
        ttft_ms: byQ((c) => c.ttft_ms),
        input_tokens: byQ((c) => c.input_tokens),
        recall: byQ((c) => c.recall),
        judge: byQ((c) => judgeByCall.get(c.id)),
      };
      perQ.set(`${model}|${condition}`, q);

      const answerable = good.filter((c) => qById.get(c.question_id)?.category !== "unanswerable");
      const unanswerable = good.filter((c) => qById.get(c.question_id)?.category === "unanswerable");
      const withPages = answerable.filter((c) => c.page_hit !== null);
      const cost = good.map((c) => callCost(c, run.config));
      const human = good.flatMap((c) => humanByCall.get(c.id) ?? []);
      const everything = [...calls, ...(run.retired ?? []).filter((c) => c.model === model && c.condition === condition)];
      const refused = everything.reduce((s, c) => s + (c.busy_rejections ?? 0), 0);
      // A failed "busy" call's last attempt is already counted in busy_rejections.
      const sent = refused + everything.filter((c) => c.status === "ok" || c.error_kind !== "network").length;
      const by_category: CellSummary["by_category"] = {};
      for (const cat of ["fact", "explain", "multi", "unanswerable"] as QuestionCategory[]) {
        const inCat = good.filter((c) => qById.get(c.question_id)?.category === cat);
        if (inCat.length) by_category[cat] = { recall: metric(inCat.map((c) => c.recall)), judge: metric(inCat.map((c) => judgeByCall.get(c.id))) };
      }
      cells.push({
        model, condition, calls: calls.length, errors: calls.length - good.length, error_kinds: kinds,
        ttft_ms: metric([...q.ttft_ms.values()]),
        total_ms: metric([...q.total_ms.values()]),
        input_tokens: metric([...q.input_tokens.values()]),
        output_tokens: metric(good.map((c) => c.output_tokens)),
        cost_per_1000: cost.length ? mean(cost) * 1000 : NaN,
        recall: metric(answerable.map((c) => c.recall)),
        page_hit_rate: withPages.length ? withPages.filter((c) => c.page_hit).length / withPages.length : NaN,
        abstention_rate: unanswerable.length ? unanswerable.filter((c) => c.correct_abstention).length / unanswerable.length : NaN,
        false_abstention_rate: answerable.length ? answerable.filter((c) => c.abstained && !c.recall).length / answerable.length : NaN,
        judge: metric(good.map((c) => judgeByCall.get(c.id))),
        human: metric(human),
        human_best_share: ratedQuestions ? good.filter((c) => c.rep === 1).reduce((n, c) => n + (bestCount.get(c.id) ?? 0), 0) / ratedQuestions : NaN,
        refused, sent, refused_rate: sent ? refused / sent : NaN,
        by_category,
      });
    }
  }

  const METRICS = ["total_ms", "ttft_ms", "input_tokens", "recall", "judge"] as const;
  const compare = (model: string, b: Condition, m: (typeof METRICS)[number], a: number[], bb: number[]): Comparison => {
    const diffs = a.map((x, i) => x - bb[i]);
    const lowerIsBetter = m === "total_ms" || m === "ttft_ms" || m === "input_tokens";
    const tol = m === "recall" ? 1e-9 : m === "judge" ? 0.25 : 0;
    let wins = 0, ties = 0, losses = 0;
    for (const x of diffs) {
      if (Math.abs(x) <= tol) ties++;
      else if (lowerIsBetter ? x < 0 : x > 0) wins++;
      else losses++;
    }
    return {
      model, a: "uebai", b, metric: m, n: a.length, mean_a: mean(a), mean_b: mean(bb),
      mean_diff: mean(diffs), diff_ci: ci95(diffs),
      ratio_median: lowerIsBetter ? median(a.map((x, i) => (x > 0 ? bb[i] / x : NaN)).filter(Number.isFinite)) : null,
      wins, ties, losses, p: signFlipP(diffs, run.config.seed),
      non_inferior: (m === "recall" || m === "judge") && a.length >= 5 ? ci95(diffs)[0] > NI_MARGIN[m] : null,
    };
  };
  /** Pairs (same question, same model) of UEBAI vs condition b for one metric, over the given models. */
  const pairs = (models: string[], b: Condition, m: (typeof METRICS)[number]) => {
    const a: number[] = [], bb: number[] = [];
    for (const model of models) {
      const A = perQ.get(`${model}|uebai`)![m], B = perQ.get(`${model}|${b}`)![m];
      for (const [id, v] of A) if (B.has(id)) { a.push(v); bb.push(B.get(id)!); }
    }
    return { a, bb };
  };

  const comparisons: Comparison[] = [];
  if (run.config.conditions.includes("uebai")) {
    // Several models: also pool every (question, model) pair — "all models together" (model "*").
    const groups = run.config.models.length > 1 ? [...run.config.models.map((m) => [m]), run.config.models] : run.config.models.map((m) => [m]);
    for (const models of groups) {
      for (const b of run.config.conditions.filter((c) => c !== "uebai")) {
        for (const m of METRICS) {
          const { a, bb } = pairs(models, b, m);
          if (a.length) comparisons.push(compare(models.length > 1 ? "*" : models[0], b, m, a, bb));
        }
      }
    }
  }

  // One-time cost of building the cards (estimate): topic finding reads the book once and the
  // note writer reads each topic's paragraphs (≈ the book again); notes come out.
  const ingest_in = 2 * run.book.full_tokens_est;
  const ingest_out = Math.round(run.book.cards_tokens * 1.3);
  return { cells, comparisons, ingest: { input_tokens: ingest_in, output_tokens: ingest_out } };
}

export type Summary = ReturnType<typeof summarize>;

/** Per-condition totals of the free retrieval check (answerable questions with findable facts). */
export function summarizeRetrieval(r: RetrievalReport) {
  const conds = Object.keys(r.rows[0]?.cells ?? {}) as Condition[];
  return conds.map((c) => {
    const withFacts = r.rows.filter((row) => row.category !== "unanswerable" && row.cells[c].facts_findable > 0);
    const withPages = r.rows.filter((row) => row.cells[c].page_in_context !== null);
    const exact = r.rows.map((row) => row.cells[c].tokens_exact).filter((x): x is number => typeof x === "number" && x > 0);
    return {
      condition: c,
      questions: withFacts.length,
      coverage: mean(withFacts.map((row) => row.cells[c].facts_found / row.cells[c].facts_findable)),
      all_facts: withFacts.length ? withFacts.filter((row) => row.cells[c].facts_found === row.cells[c].facts_findable).length / withFacts.length : NaN,
      page: withPages.length ? withPages.filter((row) => row.cells[c].page_in_context).length / withPages.length : NaN,
      tokens_est: median(r.rows.map((row) => row.cells[c].tokens_est)),
      tokens_exact: exact.length ? median(exact) : NaN,
      repeated: mean(r.rows.map((row) => row.cells[c].repeated_share).filter((x): x is number => typeof x === "number")),
    };
  });
}

/** Questions after which UEBAI's one-time filing has paid for itself (in input tokens). */
export function breakEven(ingestInput: number, fullPerQuestion: number, uebaiPerQuestion: number): number | null {
  const saved = fullPerQuestion - uebaiPerQuestion;
  return saved > 0 ? Math.ceil(ingestInput / saved) : null;
}
