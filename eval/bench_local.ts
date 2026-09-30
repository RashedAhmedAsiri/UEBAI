/**
 * Proof Lab run without the website (same engine, same saved results — they appear on the /bench
 * page afterwards). Useful when the site is password-protected or not running.
 *
 *   npx tsx --conditions=react-server eval/bench_local.ts --models gemini-3.7-flash,gemini-3.5-flash --conditions full,uebai --questions q04,q08
 *   npx tsx --conditions=react-server eval/bench_local.ts --resume <run id>
 *
 * Other options: --dataset biology1.json --reps 1 --judge <model|none> --rpm 5 --tpm 250000
 */
import fs from "node:fs";
import path from "node:path";
import { control, createRun, getRun } from "../src/lib/server/bench/runner";
import { summarize } from "../src/lib/bench/stats";
import { db } from "../src/lib/server/db";
import type { BenchRun, Condition } from "../src/lib/bench/types";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "1" : process.argv[++i]);
}

for (const line of (fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^(GEMINI_API_KEY|DEEPSEEK_API_KEY)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");

function report(run: BenchRun) {
  const s = summarize(run);
  console.log(`\nRun ${run.id} — ${run.status} — ${run.message}`);
  console.table(s.cells.map((c) => ({
    model: c.model, condition: c.condition, ok: `${c.calls - c.errors}/${c.calls}`, refused: `${c.refused}/${c.sent}`,
    "first word s": fmt(c.ttft_ms.median / 1000), "total s": fmt(c.total_ms.median / 1000), "input tokens": fmt(c.input_tokens.median, 0),
    "facts": pct(c.recall.mean), "page": pct(c.page_hit_rate), "not-in-book ok": pct(c.abstention_rate),
  })));
  console.table(s.comparisons.map((c) => ({
    model: c.model, vs: c.b, metric: c.metric, n: c.n, uebai: fmt(c.mean_a, 2), other: fmt(c.mean_b, 2),
    "×": c.ratio_median === null ? "" : fmt(c.ratio_median), "W/T/L": `${c.wins}/${c.ties}/${c.losses}`, p: fmt(c.p, 4),
    "not worse": c.non_inferior === null ? "" : c.non_inferior ? "yes" : "not yet",
  })));
}

async function main() {
  let run: BenchRun;
  if (args.has("resume")) {
    run = control(args.get("resume")!, "resume");
  } else {
    const dataset = args.get("dataset") ?? "biology1.json";
    const ds = JSON.parse(fs.readFileSync(path.join("eval", "bench", dataset), "utf8")) as { book_hint?: string };
    const teacher = args.get("teacher") ?? db().teachers.find((t) => db().sources.some((s) => s.teacher_id === t.id && s.status === "ready" && (!ds.book_hint || s.filename.includes(ds.book_hint))))?.id;
    if (!teacher) throw new Error("No teacher has this book yet");
    const judge = args.get("judge");
    run = createRun({
      teacher_id: teacher, dataset,
      question_ids: args.get("questions")?.split(",") ?? null,
      models: (args.get("models") ?? "gemini-3.6-flash").split(","),
      conditions: (args.get("conditions") ?? "full,uebai").split(",") as Condition[],
      reps: Number(args.get("reps") ?? 1),
      judge_model: judge && judge !== "none" ? judge : null,
      rpm: Number(args.get("rpm") ?? 5),
      tpm: Number(args.get("tpm") ?? 250_000),
    });
  }
  console.log(`Run ${run.id}: ${run.plan.length} measurements planned.`);
  let last = "";
  for (;;) {
    const r = getRun(run.id)!;
    const line = `${r.status} ${r.calls.length}/${r.plan.length} ${r.message}`;
    if (line !== last) { console.log(new Date().toLocaleTimeString("en-GB"), line); last = line; }
    if (r.status !== "running") { report(r); break; }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
