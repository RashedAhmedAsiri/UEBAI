/**
 * Pools several Proof Lab runs on the same question set into one analysis (every question on
 * every model is one pair, across all runs). Runs must not repeat the same (model, question).
 *
 *   npx tsx eval/combine_runs.ts <run id> <run id> …
 */
import fs from "node:fs";
import path from "node:path";
import { summarize } from "../src/lib/bench/stats";
import { gradeAnswer } from "../src/lib/bench/grade";
import type { BenchRun, Condition } from "../src/lib/bench/types";

const ids = process.argv.slice(2);
if (ids.length < 1) throw new Error("Give one or more run ids");
const runs = ids.map((id) => JSON.parse(fs.readFileSync(path.join("data", "bench", `${id}.json`), "utf8")) as BenchRun);
const base = runs[0];
const seen = new Set<string>();
for (const r of runs) for (const c of r.calls) {
  const key = `${c.model}|${c.question_id}|${c.condition}|${c.rep}`;
  if (seen.has(key)) throw new Error(`Runs overlap on ${key}`);
  seen.add(key);
}
const conditions = base.config.conditions.filter((c) => runs.every((r) => r.config.conditions.includes(c))) as Condition[];
const questions = [...new Map(runs.flatMap((r) => r.dataset.questions).map((q) => [q.id, q])).values()];
const merged: BenchRun = {
  ...base,
  id: ids.join("+"),
  config: { ...base.config, models: [...new Set(runs.flatMap((r) => r.config.models))], conditions },
  dataset: { ...base.dataset, questions },
  plan: runs.flatMap((r) => r.plan),
  calls: runs.flatMap((r) => r.calls).filter((c) => conditions.includes(c.condition)),
  retired: runs.flatMap((r) => r.retired ?? []),
  judgments: runs.flatMap((r) => r.judgments),
  ratings: runs.flatMap((r) => r.ratings),
};
const byId = new Map(questions.map((q) => [q.id, q]));
for (const c of merged.calls) if (c.status === "ok") Object.assign(c, gradeAnswer(c.answer, byId.get(c.question_id)!));

const s = summarize(merged);
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const pooled = merged.config.models.length > 1 ? "*" : merged.config.models[0];
console.log(`${merged.dataset.name}: ${runs.length} runs, ${merged.config.models.length} models, ${new Set(merged.calls.map((c) => c.question_id)).size} questions`);
console.table(s.comparisons.filter((c) => c.model === pooled).map((c) => ({
  vs: c.b, metric: c.metric, pairs: c.n, uebai: f(c.mean_a), other: f(c.mean_b), "diff 95% CI": `${f(c.diff_ci[0])} … ${f(c.diff_ci[1])}`,
  "× median": c.ratio_median === null ? "" : f(c.ratio_median, 1), "better/tie/worse": `${c.wins}/${c.ties}/${c.losses}`, p: c.p < 0.0001 ? "<0.0001" : f(c.p, 4),
  "not worse": c.non_inferior === null ? "" : c.non_inferior ? "PROVEN" : "not yet",
})));
const abst = (cond: Condition) => {
  const u = merged.calls.filter((c) => c.condition === cond && c.status === "ok" && c.correct_abstention !== null);
  return `${u.filter((c) => c.correct_abstention).length}/${u.length}`;
};
const pages = (cond: Condition) => {
  const u = merged.calls.filter((c) => c.condition === cond && c.status === "ok" && c.page_hit !== null);
  return `${u.filter((c) => c.page_hit).length}/${u.length}`;
};
console.log(`Said "not in the book" on unanswerable questions — UEBAI ${abst("uebai")}, whole book ${abst("full")}`);
console.log(`Cited the right page — UEBAI ${pages("uebai")}, whole book ${pages("full")}`);
