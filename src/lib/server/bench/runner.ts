import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DATA_DIR, now, uid } from "../db";
import { buildContext, loadBook, SYSTEM_PROMPT, userPrompt, type Book } from "./context";
import { BenchError, callModel, type LlmResult } from "./llm";
import { limitFromMessage } from "@/lib/bench/errors";
import { combinePrompt, modelLimit, NOTHING_HERE, partBudget, partPrompt, splitByPages } from "@/lib/bench/parts";
import { gradeAnswer } from "@/lib/bench/grade";
import { hashSeed, rng, shuffle } from "@/lib/bench/stats";
import { estimateTokens, extractJson } from "@/lib/text";
import type { BenchCall, BenchConfig, BenchDataset, BenchQuestion, BenchRun, Condition, HumanRating, JudgeScore, RunSummary } from "@/lib/bench/types";

/**
 * Proof Lab runner: executes a benchmark plan in the background, one call at a time (so timings
 * don't compete), saving after every call so a run survives restarts and daily quota limits
 * (it pauses and can be resumed tomorrow). Results live in data/bench/<id>.json.
 */

const BENCH_DIR = path.join(DATA_DIR, "bench");
const DATASET_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "eval", "bench");
const MODEL_ID = /^(?:ollama:)?[\w.\-:/]{2,80}$/;

const QuestionSchema = z.object({
  id: z.string().min(1).max(40),
  q: z.string().min(3),
  category: z.enum(["fact", "explain", "multi", "unanswerable"]),
  answer: z.string(),
  facts: z.array(z.string()),
  pages: z.array(z.number().int()),
});
const DatasetSchema = z.object({
  name: z.string(),
  book_hint: z.string().optional(),
  protocol: z.string().optional(),
  questions: z.array(QuestionSchema).min(1),
});

export const ConfigSchema = z.object({
  teacher_id: z.string().min(1),
  dataset: z.string().regex(/^[\w.-]+\.json$/),
  question_ids: z.array(z.string()).nullable().default(null),
  models: z.array(z.string().regex(MODEL_ID)).min(1).max(4),
  conditions: z.array(z.enum(["full", "uebai", "rag", "trunc"])).min(1),
  reps: z.number().int().min(1).max(10).default(1),
  judge_model: z.string().regex(MODEL_ID).nullable().default(null),
  small_window: z.number().int().min(1000).max(2_000_000).default(8192),
  thinking: z.enum(["low", "high"]).default("low"),
  max_output_tokens: z.number().int().min(256).max(65536).default(8192),
  rpm: z.number().min(1).max(1000).default(5),
  tpm: z.number().min(1000).max(100_000_000).default(250_000),
  price_in: z.number().min(0).max(1000).default(0.5),
  price_cached: z.number().min(0).max(1000).default(0.05),
  price_out: z.number().min(0).max(1000).default(3),
  seed: z.number().int().default(1448),
});

// ── Storage ──────────────────────────────────────────────────────────────

type G = typeof globalThis & {
  __uebaiBench?: { runs: Map<string, BenchRun>; active: Map<string, { stop: null | "pause" | "cancel" }>; pace: Map<string, { t: number; tokens: number }[]> };
};
const state: NonNullable<G["__uebaiBench"]> = ((globalThis as G).__uebaiBench ??= { runs: new Map(), active: new Map(), pace: new Map() });

const fileFor = (id: string) => path.join(BENCH_DIR, `${id}.json`);
export const validRunId = (id: string) => /^[\w-]{4,60}$/.test(id);

function persist(run: BenchRun) {
  run.updated_at = now();
  fs.mkdirSync(BENCH_DIR, { recursive: true });
  const tmp = fileFor(run.id) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(run));
  fs.renameSync(tmp, fileFor(run.id));
}

export function getRun(id: string): BenchRun | null {
  if (!validRunId(id)) return null;
  let run = state.runs.get(id);
  if (!run) {
    if (!fs.existsSync(fileFor(id))) return null;
    run = JSON.parse(fs.readFileSync(fileFor(id), "utf8")) as BenchRun;
    run.config.price_cached ??= run.config.price_in / 10;
    // Grades are recomputed from the saved answers, so grader fixes apply to old runs too.
    const questions = new Map(run.dataset.questions.map((q) => [q.id, q]));
    for (const c of run.calls) if (c.status === "ok" && questions.has(c.question_id)) Object.assign(c, gradeAnswer(c.answer, questions.get(c.question_id)!));
    state.runs.set(id, run);
  }
  if (run.status === "running" && !state.active.has(id)) {
    run.status = "paused";
    run.message = "Interrupted by a server restart — press Resume.";
    persist(run);
  }
  return run;
}

export function listRuns(): RunSummary[] {
  if (!fs.existsSync(BENCH_DIR)) return [];
  return fs.readdirSync(BENCH_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return getRun(f.slice(0, -5)); } catch { return null; } })
    .filter((r): r is BenchRun => !!r && Array.isArray(r.plan) && Array.isArray(r.calls))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => ({
      id: r.id, created_at: r.created_at, status: r.status, message: r.message, dataset: r.dataset.name,
      models: r.config.models, conditions: r.config.conditions, done: r.calls.length, total: r.plan.length,
    }));
}

export function deleteRun(id: string) {
  const ctl = state.active.get(id);
  if (ctl) ctl.stop = "cancel";
  state.runs.delete(id);
  if (validRunId(id) && fs.existsSync(fileFor(id))) fs.rmSync(fileFor(id));
}

export function listDatasets(): { file: string; dataset: BenchDataset }[] {
  if (!fs.existsSync(DATASET_DIR)) return [];
  return fs.readdirSync(DATASET_DIR).filter((f) => f.endsWith(".json")).flatMap((file) => {
    try {
      return [{ file, dataset: DatasetSchema.parse(JSON.parse(fs.readFileSync(path.join(DATASET_DIR, file), "utf8"))) as BenchDataset }];
    } catch (e) {
      console.warn(`[bench] skipping dataset ${file}: ${(e as Error).message}`);
      return [];
    }
  });
}

// ── Create / control ─────────────────────────────────────────────────────

export function createRun(input: unknown): BenchRun {
  const config = ConfigSchema.parse(input) as BenchConfig;
  const ds = listDatasets().find((d) => d.file === config.dataset);
  if (!ds) throw new Error("Question set not found");
  const questions = config.question_ids ? ds.dataset.questions.filter((q) => config.question_ids!.includes(q.id)) : ds.dataset.questions;
  if (!questions.length) throw new Error("Pick at least one question");
  const all = [...config.models, ...(config.judge_model ? [config.judge_model] : [])];
  if (all.some((m) => m.startsWith("deepseek")) && !process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not set");
  if (all.some((m) => !m.startsWith("ollama:") && !m.startsWith("deepseek")) && !process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const book = loadBook(config.teacher_id, ds.dataset.book_hint);

  // Rep-major order: repetition 1 of every question finishes first, so a run stopped by a quota
  // limit still has one complete, comparable pass. Question and condition order are shuffled.
  const rand = rng(config.seed);
  const order = shuffle(questions.map((q) => q.id), rand);
  const plan: BenchRun["plan"] = [];
  for (let rep = 1; rep <= config.reps; rep++) {
    for (const question_id of order) for (const model of config.models) {
      for (const condition of shuffle(config.conditions, rand)) plan.push({ question_id, model, condition, rep });
    }
  }
  const run: BenchRun = {
    id: `${new Date().toISOString().slice(0, 10)}-${uid().slice(0, 8)}`,
    created_at: now(), updated_at: now(), status: "running", message: "Starting…",
    config: { ...config, question_ids: questions.map((q) => q.id) },
    dataset: { ...ds.dataset, questions },
    dataset_sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(DATASET_DIR, ds.file))).digest("hex"),
    book: book.info, plan, calls: [], judgments: [], ratings: [],
  };
  state.runs.set(run.id, run);
  persist(run);
  start(run);
  return run;
}

function start(run: BenchRun) {
  if (state.active.has(run.id)) return;
  const ctl = { stop: null as null | "pause" | "cancel" };
  state.active.set(run.id, ctl);
  run.status = "running";
  persist(run);
  void loop(run, ctl);
}

export type RunAction = "pause" | "resume" | "cancel" | "judge" | "retry";

export function control(id: string, action: RunAction, judgeModel?: string | null): BenchRun {
  const run = getRun(id);
  if (!run) throw new Error("Run not found");
  const ctl = state.active.get(id);
  if (action === "pause" || action === "cancel") {
    if (ctl) ctl.stop = action;
    else if (action === "cancel") { run.status = "cancelled"; run.message = "Cancelled."; persist(run); }
    return run;
  }
  if (action === "judge") {
    if (judgeModel !== undefined) {
      if (judgeModel !== null && !MODEL_ID.test(judgeModel)) throw new Error("Invalid model name");
      if (judgeModel !== run.config.judge_model) run.judgments = [];
      run.config.judge_model = judgeModel;
    }
    run.judgments = run.judgments.filter((j) => !j.error);
  }
  if (action === "retry" && !ctl) {
    // Temporary failures (server overload, rate limits) are measured again; "too large" stays — it's a result.
    // The failed attempts are remembered so the report can still show how often the server refused.
    const failedCalls = run.calls.filter((c) => c.status === "error" && c.error_kind !== "too_large");
    const failed = new Set(failedCalls.map((c) => `${c.question_id}|${c.model}`));
    run.retired = [...(run.retired ?? []), ...failedCalls];
    run.calls = run.calls.filter((c) => c.status !== "error" || c.error_kind === "too_large");
    run.judgments = run.judgments.filter((j) => !failed.has(`${j.question_id}|${j.model}`));
  }
  if (!ctl) start(run);
  return run;
}

// ── Execution ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(ms: number, ctl: { stop: unknown }) {
  const end = Date.now() + ms;
  while (Date.now() < end && !ctl.stop) await sleep(Math.min(1000, end - Date.now()));
}

// Free-tier input-token limits per minute that are far below the run's setting (measured 2026-09-29),
// so one run can mix a big model and a small one.
const KNOWN_TPM: [RegExp, number][] = [[/^gemma/, 15_000]];

/** Client-side pacing under the model's per-minute request/token limits — outside the timed region. */
async function pace(run: BenchRun, model: string, tokens: number, ctl: { stop: unknown }) {
  // DeepSeek (paid) has no small per-minute caps; the run's settings are for free Gemini keys.
  const paid = /^deepseek/.test(model);
  const rpm = paid ? Math.max(run.config.rpm, 30) : run.config.rpm;
  const tpm = paid ? Infinity : Math.min(run.config.tpm, KNOWN_TPM.find(([re]) => re.test(model))?.[1] ?? Infinity);
  const hist = state.pace.get(model) ?? [];
  for (;;) {
    const t = Date.now();
    const recent = hist.filter((h) => t - h.t < 60_000);
    const used = recent.reduce((n, h) => n + h.tokens, 0);
    if (recent.length < rpm && (used + tokens <= tpm || recent.length === 0)) {
      const entry = { t, tokens };
      state.pace.set(model, [...recent, entry]);
      return entry;
    }
    const wait = Math.max(1000, 60_000 - (t - recent[0].t) + 100);
    run.message = `Waiting {s}s for the per-minute limit of {model}…`.replace("{s}", String(Math.ceil(wait / 1000))).replace("{model}", model);
    persist(run);
    await waitFor(Math.min(wait, 5000), ctl);
    if (ctl.stop) return null;
  }
}

const same = (c: { question_id: string; model: string; condition: Condition; rep: number }, p: typeof c) =>
  c.question_id === p.question_id && c.model === p.model && c.condition === p.condition && c.rep === p.rep;

async function loop(run: BenchRun, ctl: { stop: null | "pause" | "cancel" }) {
  const exhausted = new Set<string>();
  try {
    const book = loadBook(run.config.teacher_id, run.dataset.book_hint);
    const questions = new Map(run.dataset.questions.map((q) => [q.id, q]));
    for (const item of run.plan) {
      if (ctl.stop) break;
      if (exhausted.has(item.model) || run.calls.some((c) => same(c, item))) continue;
      run.message = `Measuring {done}/{total}…`.replace("{done}", String(run.calls.length + 1)).replace("{total}", String(run.plan.length));
      persist(run);
      const call = await measure(run, book, questions.get(item.question_id)!, item, ctl);
      if (call === "quota_day") { exhausted.add(item.model); continue; }
      if (!call) break;
      run.calls.push(call);
      persist(run);
    }
    if (!ctl.stop && run.config.judge_model) await judgeAll(run, ctl, exhausted);

    const pending = run.plan.length - run.calls.length;
    const unjudged = run.config.judge_model ? judgeGroups(run).filter((g) => !run.judgments.some((j) => j.question_id === g.question_id && j.model === g.model)).length : 0;
    if (ctl.stop === "cancel") { run.status = "cancelled"; run.message = "Cancelled."; }
    else if (ctl.stop === "pause") { run.status = "paused"; run.message = "Paused."; }
    else if (exhausted.size && (pending || unjudged)) {
      run.status = "paused";
      run.message = `Daily quota for {model} is used up — resume tomorrow.`.replace("{model}", [...exhausted].join("، "));
    } else { run.status = "done"; run.message = "Finished."; }
  } catch (e) {
    console.error("[bench] run failed", e);
    run.status = "failed";
    run.message = (e as Error).message;
  } finally {
    state.active.delete(run.id);
    persist(run);
  }
}

type Outcome = { ok: LlmResult; busy: number } | { err: BenchError; busy: number } | "quota_day" | null;

/**
 * One timed request with pacing and retries outside the timing: per-minute limits wait as long as
 * the provider says; a busy server gets 5 tries with back-off (≈2.5 min), after which the call is
 * recorded as failed (and can be measured again later with "Retry failed", at a quieter time).
 */
async function callWithRetry(run: BenchRun, model: string, user: string, label: string, ctl: { stop: unknown }): Promise<Outcome> {
  const cfg = run.config;
  const est = estimateTokens(SYSTEM_PROMPT + user);
  let busy = 0;
  for (let attempt = 1; ; attempt++) {
    if (ctl.stop) return null;
    const slot = await pace(run, model, Math.round(est * 1.2), ctl);
    if (!slot) return null;
    try {
      const r = await callModel(model, SYSTEM_PROMPT, user, {
        maxOutput: cfg.max_output_tokens, thinking: cfg.thinking, numCtx: cfg.small_window, promptTokensEst: est,
      });
      if (r.input_tokens) slot.tokens = r.input_tokens;
      return { ok: r, busy };
    } catch (e) {
      const err = e instanceof BenchError ? e : new BenchError((e as Error).message, "other");
      console.warn(`[bench] ${label} attempt ${attempt}: ${err.kind} ${err.message.slice(0, 400)}`);
      if (err.kind === "quota_day") return "quota_day";
      // Refused ("busy") requests still seem to count against the per-minute token allowance
      // (they are often followed by a per-minute quota error), so their slot stays booked.
      if (err.kind === "network") busy++;
      if (err.kind === "too_large") slot.tokens = 0; // rejected up front: nothing was processed
      if ((err.kind === "quota_minute" && attempt < 6) || (err.kind === "network" && attempt < 5)) {
        const wait = err.kind === "network" ? Math.min(60_000, err.retryAfterMs * 2 ** (attempt - 1)) : err.retryAfterMs;
        const msg = err.kind === "network" ? "{model} is busy — trying again in {s}s…" : "Waiting {s}s for the per-minute limit of {model}…";
        run.message = msg.replace("{s}", String(Math.ceil(wait / 1000))).replace("{model}", model);
        persist(run);
        await waitFor(wait, ctl);
        continue;
      }
      return { err, busy };
    }
  }
}

async function measure(run: BenchRun, book: Book, q: BenchQuestion, item: BenchRun["plan"][number], ctl: { stop: unknown }): Promise<BenchCall | "quota_day" | null> {
  const cfg = run.config;
  const label = `${item.model}/${item.condition}/${item.question_id}`;
  const ctx = buildContext(book, item.condition, q.q, cfg.small_window);
  const user = userPrompt(ctx.material, q.q);
  const est = estimateTokens(SYSTEM_PROMPT + user);
  run.message = `Measuring {done}/{total}…`.replace("{done}", String(run.calls.length + 1)).replace("{total}", String(run.plan.length));
  persist(run);
  const base = {
    id: uid(), ...item, prep_ms: round(ctx.prep_ms), context_tokens_est: est, context_chars: user.length,
    topics: ctx.topics, started_at: now(),
  };

  // The whole book always means the whole book: if it can't go in one request, read it in parts.
  const limit = modelLimit(item.model, cfg.small_window);
  if (item.condition === "full" && est * 1.3 > limit) return measureInParts(run, book, q, item, base, limit, ctl);

  const out = await callWithRetry(run, item.model, user, label, ctl);
  if (out === null || out === "quota_day") return out;
  if ("err" in out) {
    const learned = limitFromMessage(out.err.message);
    if (item.condition === "full" && out.err.kind === "too_large") return measureInParts(run, book, q, item, base, learned ?? Math.floor(est * 0.5), ctl);
    return failedCall(base, out.err, out.busy);
  }
  const r = out.ok;
  return {
    ...base, busy_rejections: out.busy, status: "ok", model_version: r.model_version,
    // UEBAI's routing/retrieval time is part of what the student waits for.
    ttft_ms: r.ttft_ms === null ? null : round(r.ttft_ms + ctx.prep_ms),
    total_ms: round(r.total_ms + ctx.prep_ms),
    input_tokens: r.input_tokens, cached_tokens: r.cached_tokens, output_tokens: r.output_tokens, thought_tokens: r.thought_tokens,
    truncated: r.truncated, answer: r.text.trim(), ...gradeAnswer(r.text, q),
  };
}

type CallBase = Pick<BenchCall, "id" | "question_id" | "model" | "condition" | "rep" | "prep_ms" | "context_tokens_est" | "context_chars" | "topics" | "started_at">;

function failedCall(base: CallBase, err: BenchError, busy: number): BenchCall {
  return {
    ...base, busy_rejections: busy, status: "error", error: err.message.slice(0, 500), error_kind: err.kind,
    ttft_ms: null, total_ms: null, input_tokens: null, cached_tokens: null, output_tokens: null, thought_tokens: null,
    answer: "", recall: null, cited_pages: [], page_hit: null, abstained: false, correct_abstention: null,
  };
}

/**
 * Whole book for a model whose window (or per-minute allowance) is smaller than the book: every
 * part of the book is asked the question, then one more request combines the part answers.
 * Timing is the whole-book method's BEST case — as if all parts were read at the same time:
 * slowest part + the combining request. Tokens are the sum of every request.
 */
async function measureInParts(run: BenchRun, book: Book, q: BenchQuestion, item: BenchRun["plan"][number], base: CallBase, limit: number, ctl: { stop: unknown }): Promise<BenchCall | "quota_day" | null> {
  const parts = splitByPages(book.fullText, partBudget(limit));
  const label = `${item.model}/full-in-parts/${item.question_id}`;
  let busy = 0, slowestPart = 0, input = 0, cached = 0, output = 0, thought = 0, version = item.model;
  const partial: string[] = [];
  const add = (r: LlmResult) => {
    input += r.input_tokens ?? 0; cached += r.cached_tokens ?? 0; output += r.output_tokens ?? 0; thought += r.thought_tokens ?? 0;
    version = r.model_version;
  };
  for (let i = 0; i < parts.length; i++) {
    run.message = `Measuring {done}/{total}… (whole book, part {p} of {n})`
      .replace("{done}", String(run.calls.length + 1)).replace("{total}", String(run.plan.length)).replace("{p}", String(i + 1)).replace("{n}", String(parts.length));
    persist(run);
    const out = await callWithRetry(run, item.model, `${userPrompt(parts[i], q.q)}\n\n${partPrompt(i, parts.length)}`, `${label}#${i + 1}`, ctl);
    if (out === null || out === "quota_day") return out;
    busy += out.busy;
    if ("err" in out) return { ...failedCall(base, out.err, busy), parts: parts.length };
    add(out.ok);
    slowestPart = Math.max(slowestPart, out.ok.total_ms);
    if (!out.ok.text.includes(NOTHING_HERE)) partial.push(`(من الجزء ${i + 1})\n${out.ok.text.trim()}`);
  }
  const out = await callWithRetry(run, item.model, combinePrompt(q.q, parts.length, partial), `${label}#combine`, ctl);
  if (out === null || out === "quota_day") return out;
  busy += out.busy;
  if ("err" in out) return { ...failedCall(base, out.err, busy), parts: parts.length };
  add(out.ok);
  const r = out.ok;
  return {
    ...base, busy_rejections: busy, status: "ok", model_version: version, parts: parts.length,
    ttft_ms: r.ttft_ms === null ? null : round(slowestPart + r.ttft_ms),
    total_ms: round(slowestPart + r.total_ms),
    input_tokens: input, cached_tokens: cached, output_tokens: output, thought_tokens: thought,
    answer: r.text.trim(), ...gradeAnswer(r.text, q),
  };
}

const round = (x: number) => Math.round(x);

// ── Blind judge ──────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are a strict, impartial grader for a high-school biology exam written in Arabic.
You receive a student's question, the REFERENCE ANSWER written by a teacher from the textbook, the KEY FACTS, and several candidate answers labelled A, B, C… written by different systems. You do not know which system wrote which answer. Grade every candidate independently against the reference:
- correctness (0-10): are its claims consistent with the reference? Any wrong or contradicting fact lowers it strongly.
- completeness (0-10): how much of the reference answer / key facts it covers.
- faithfulness (0-10): 10 = it adds nothing that is wrong or unsupported by the reference; lower for invented or doubtful claims.
If the reference says the answer is NOT in the book: a candidate that clearly says the book does not cover it gets 10/10/10; a candidate that answers anyway from general knowledge gets correctness at most 3 and faithfulness at most 2.
Ignore style, length, formatting, page citations and language quality. Never reward length.
Reply with JSON only: {"grades":[{"label":"A","correctness":0,"completeness":0,"faithfulness":0,"note":"one short sentence in Arabic"}]}`;

function judgeGroups(run: BenchRun) {
  const groups: { question_id: string; model: string }[] = [];
  for (const q of run.dataset.questions) for (const model of run.config.models) {
    const planned = run.plan.filter((p) => p.question_id === q.id && p.model === model && p.rep === 1);
    const done = run.calls.filter((c) => c.question_id === q.id && c.model === model && c.rep === 1);
    // Judge a question only once all its conditions have an answer (or a final error).
    if (planned.length && done.length === planned.length && done.some((c) => c.status === "ok")) groups.push({ question_id: q.id, model });
  }
  return groups;
}

const clamp10 = (x: unknown) => Math.max(0, Math.min(10, Number(x) || 0));

async function judgeAll(run: BenchRun, ctl: { stop: unknown }, exhausted: Set<string>) {
  const jm = run.config.judge_model!;
  const groups = judgeGroups(run).filter((g) => !run.judgments.some((j) => j.question_id === g.question_id && j.model === g.model));
  let i = 0;
  for (const g of groups) {
    i++;
    if (ctl.stop || exhausted.has(jm)) return;
    const q = run.dataset.questions.find((x) => x.id === g.question_id)!;
    const calls = run.calls.filter((c) => c.question_id === g.question_id && c.model === g.model && c.rep === 1 && c.status === "ok");
    const order = shuffle(calls.map((c) => c.id), rng(hashSeed(`${run.config.seed}|${g.question_id}|${g.model}`)));
    const label = (k: number) => String.fromCharCode(65 + k);
    const user = [
      `QUESTION:\n${q.q}`,
      `REFERENCE ANSWER:\n${q.answer}`,
      `KEY FACTS:\n${q.facts.length ? q.facts.map((f) => `- ${f.split("|")[0]}`).join("\n") : "(none — the book does not answer this question)"}`,
      ...order.map((id, k) => `CANDIDATE ${label(k)}:\n${calls.find((c) => c.id === id)!.answer}`),
    ].join("\n\n");
    for (let attempt = 1; ; attempt++) {
      if (ctl.stop) return;
      run.message = `Judging answers {done}/{total}…`.replace("{done}", String(i)).replace("{total}", String(groups.length));
      persist(run);
      const est = estimateTokens(JUDGE_SYSTEM + user);
      if (!(await pace(run, jm, est, ctl))) return;
      try {
        const r = await callModel(jm, JUDGE_SYSTEM, user, { maxOutput: 8192, thinking: "high", numCtx: 16384, promptTokensEst: est, json: true });
        const parsed = extractJson<{ grades?: { label?: string; correctness?: number; completeness?: number; faithfulness?: number; note?: string }[] }>(r.text);
        const scores: Record<string, JudgeScore> = {};
        for (const gr of parsed.grades ?? []) {
          const k = (gr.label ?? "").trim().toUpperCase().charCodeAt(0) - 65;
          if (k < 0 || k >= order.length) continue;
          const s = { correctness: clamp10(gr.correctness), completeness: clamp10(gr.completeness), faithfulness: clamp10(gr.faithfulness) };
          scores[order[k]] = { ...s, total: (s.correctness + s.completeness + s.faithfulness) / 3, note: String(gr.note ?? "").slice(0, 300) };
        }
        if (Object.keys(scores).length !== order.length) throw new BenchError("The judge did not grade every answer", "other");
        run.judgments.push({ question_id: g.question_id, model: g.model, rep: 1, judge_model: r.model_version, order, scores, at: now() });
        persist(run);
        break;
      } catch (e) {
        const err = e instanceof BenchError ? e : new BenchError((e as Error).message, "other");
        if (err.kind === "quota_day") { exhausted.add(jm); return; }
        if (attempt < 4 && err.kind !== "too_large") {
          await waitFor(err.kind === "other" ? 3000 : err.retryAfterMs, ctl);
          continue;
        }
        run.judgments.push({ question_id: g.question_id, model: g.model, rep: 1, judge_model: jm, order, scores: {}, error: err.message.slice(0, 300), at: now() });
        persist(run);
        break;
      }
    }
  }
}

// ── Human blind rating ───────────────────────────────────────────────────

export interface BlindItem {
  question_id: string;
  model: string | null;
  q: string;
  reference: string;
  answers: { id: string; text: string }[];
  rating: HumanRating | null;
}

/** Answers without system names, in a different random order for every rater. */
export function blindItems(run: BenchRun, rater: string): BlindItem[] {
  const out: BlindItem[] = [];
  for (const q of run.dataset.questions) for (const model of run.config.models) {
    const calls = run.calls.filter((c) => c.question_id === q.id && c.model === model && c.rep === 1 && c.status === "ok");
    if (calls.length < 2) continue;
    const order = shuffle(calls, rng(hashSeed(`${rater}|${q.id}|${model}`)));
    out.push({
      question_id: q.id, model: run.config.models.length > 1 ? model : null, q: q.q, reference: q.answer,
      answers: order.map((c) => ({ id: c.id, text: c.answer })),
      rating: run.ratings.find((r) => r.rater === rater && r.question_id === q.id && r.model === model) ?? null,
    });
  }
  return out;
}

const RatingSchema = z.object({
  rater: z.string().trim().min(1).max(60),
  question_id: z.string().min(1),
  model: z.string().nullable(),
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  best: z.string().nullable(),
});

export function addRating(id: string, input: unknown): HumanRating {
  const run = getRun(id);
  if (!run) throw new Error("Run not found");
  const r = RatingSchema.parse(input);
  const model = r.model ?? run.config.models[0];
  const ids = new Set(run.calls.filter((c) => c.question_id === r.question_id && c.model === model && c.rep === 1 && c.status === "ok").map((c) => c.id));
  if (!Object.keys(r.scores).length || Object.keys(r.scores).some((k) => !ids.has(k)) || (r.best && !ids.has(r.best))) throw new Error("Rating does not match this question's answers");
  const rating: HumanRating = { rater: r.rater, question_id: r.question_id, model, scores: r.scores, best: r.best, at: now() };
  run.ratings = run.ratings.filter((x) => !(x.rater === rating.rater && x.question_id === rating.question_id && x.model === model));
  run.ratings.push(rating);
  persist(run);
  return rating;
}

// ── Export ───────────────────────────────────────────────────────────────

export function toCsv(run: BenchRun): string {
  const judge = new Map<string, JudgeScore>();
  for (const j of run.judgments) for (const [id, s] of Object.entries(j.scores)) judge.set(id, s);
  const human = new Map<string, number[]>();
  for (const r of run.ratings) for (const [id, s] of Object.entries(r.scores)) human.set(id, [...(human.get(id) ?? []), s]);
  const cat = new Map(run.dataset.questions.map((q) => [q.id, q.category]));
  const cols = [
    "question_id", "category", "model", "model_version", "condition", "rep", "status", "error_kind", "prep_ms", "ttft_ms", "total_ms",
    "input_tokens", "cached_tokens", "output_tokens", "thought_tokens", "context_tokens_est", "recall", "page_hit", "abstained",
    "correct_abstention", "judge_total", "judge_correctness", "judge_completeness", "judge_faithfulness", "human_mean", "cited_pages", "topics", "answer",
  ];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(" ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = run.calls.map((c) => {
    const j = judge.get(c.id);
    const h = human.get(c.id);
    return [
      c.question_id, cat.get(c.question_id), c.model, c.model_version, c.condition, c.rep, c.status, c.error_kind, c.prep_ms, c.ttft_ms, c.total_ms,
      c.input_tokens, c.cached_tokens, c.output_tokens, c.thought_tokens, c.context_tokens_est, c.recall, c.page_hit, c.abstained,
      c.correct_abstention, j?.total.toFixed(2), j?.correctness, j?.completeness, j?.faithfulness, h ? (h.reduce((a, b) => a + b, 0) / h.length).toFixed(2) : "",
      c.cited_pages, c.topics, c.answer,
    ].map(cell).join(",");
  });
  // BOM so Excel opens Arabic text correctly.
  return "﻿" + [cols.join(","), ...rows].join("\n");
}
