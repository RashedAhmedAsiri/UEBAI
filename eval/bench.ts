/**
 * Proof Lab from the command line (same engine as the /bench page). Needs the site running.
 *
 *   npx tsx eval/bench.ts --models gemini-3.6-flash --conditions full,uebai,rag --reps 3 --judge gemini-3.8-flash
 *   npx tsx eval/bench.ts --questions q01,q05,u01 --conditions full,uebai     (a quick pilot)
 *   npx tsx eval/bench.ts --run <run id>                                     (watch / summarize a run)
 *
 * Options: --teacher <id> (default: the teacher whose book matches the question set)
 *          --dataset biology1.json   --small-window 8192   --thinking low|high   --rpm 5   --tpm 250000
 * If the site has a password (SITE_PASSWORD in .env.local), the script signs in with it.
 */
import fs from "node:fs";
import { summarize } from "../src/lib/bench/stats";
import type { BenchRun, Condition } from "../src/lib/bench/types";

const BASE = process.env.UEBAI_URL ?? "http://localhost:3000";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "1" : process.argv[++i]);
}

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() || undefined;
  } catch { return undefined; }
}

let cookie = "";
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let r = await fetch(BASE + url, { ...init, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(init?.headers ?? {}) } });
  if (r.status === 401 && !cookie && (await login())) return api<T>(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url}: ${(d as { error?: string }).error ?? r.status}`);
  return d as T;
}

/** Only when the site asks for it (password-protected public copy). */
async function login(): Promise<boolean> {
  const pw = envValue("SITE_PASSWORD");
  if (!pw) throw new Error("The site needs a password: set SITE_PASSWORD in .env.local");
  const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
  const set = r.headers.get("set-cookie");
  if (!r.ok || !set) throw new Error("Could not sign in with SITE_PASSWORD");
  cookie = set.split(";")[0];
  return true;
}

const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");

function report(run: BenchRun) {
  const s = summarize(run);
  console.log(`\nRun ${run.id} — ${run.status} — ${run.dataset.name}`);
  console.log(`Book: ${run.book.labels.join(", ")} — ${run.book.pages} pages, ~${run.book.full_tokens_est.toLocaleString()} tokens; ${run.book.topics} topic cards`);
  console.table(s.cells.map((c) => ({
    model: c.model, condition: c.condition, ok: `${c.calls - c.errors}/${c.calls}`,
    "first word s": fmt(c.ttft_ms.median / 1000, 1), "total s": fmt(c.total_ms.median / 1000, 1),
    "input tokens": fmt(c.input_tokens.median), "$/1000 q": fmt(c.cost_per_1000, 2),
    "fact recall": pct(c.recall.mean), "right page": pct(c.page_hit_rate), "says not-in-book (unanswerable)": pct(c.abstention_rate),
    "judge /10": fmt(c.judge.mean, 1), "human /5": fmt(c.human.mean, 1),
  })));
  const rows = s.comparisons.map((c) => ({
    model: c.model, "uebai vs": c.b, metric: c.metric, n: c.n,
    uebai: fmt(c.mean_a, c.metric === "recall" ? 2 : 1), other: fmt(c.mean_b, c.metric === "recall" ? 2 : 1),
    "× (median)": c.ratio_median === null ? "" : fmt(c.ratio_median, 1), "win/tie/loss": `${c.wins}/${c.ties}/${c.losses}`, p: fmt(c.p, 4),
  }));
  if (rows.length) console.table(rows);
  for (const c of run.calls.filter((x) => x.status === "error")) console.log(`  error ${c.question_id}/${c.model}/${c.condition}: ${c.error_kind} — ${c.error}`);
}

async function watch(id: string) {
  let last = "";
  for (;;) {
    const { run } = await api<{ run: BenchRun }>(`/api/bench/${id}`);
    const line = `${run.status} ${run.calls.length}/${run.plan.length} ${run.message}`;
    if (line !== last) { console.log(new Date().toLocaleTimeString(), line); last = line; }
    if (run.status !== "running") return report(run);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  if (args.has("run")) return watch(args.get("run")!);
  const home = await api<{ teachers: { id: string; name: string; books: { filename: string }[] }[]; datasets: { file: string; book_hint: string | null }[] }>("/api/bench");
  const dataset = args.get("dataset") ?? "biology1.json";
  const ds = home.datasets.find((d) => d.file === dataset);
  if (!ds) throw new Error(`Question set ${dataset} not found in eval/bench/`);
  const teacher = args.get("teacher") ?? home.teachers.find((t) => !ds.book_hint || t.books.some((b) => b.filename.includes(ds.book_hint!)))?.id;
  if (!teacher) throw new Error("No teacher has this book — upload it in the app first");
  const judge = args.get("judge");
  const { run } = await api<{ run: BenchRun }>("/api/bench", {
    method: "POST",
    body: JSON.stringify({
      teacher_id: teacher, dataset,
      question_ids: args.get("questions")?.split(",") ?? null,
      models: (args.get("models") ?? "gemini-3.6-flash").split(","),
      conditions: (args.get("conditions") ?? "full,uebai,rag").split(",") as Condition[],
      reps: Number(args.get("reps") ?? 1),
      judge_model: judge && judge !== "none" ? judge : null,
      small_window: Number(args.get("small-window") ?? 8192),
      thinking: args.get("thinking") ?? "low",
      rpm: Number(args.get("rpm") ?? 5),
      tpm: Number(args.get("tpm") ?? 250_000),
    }),
  });
  console.log(`Started run ${run.id} (${run.plan.length} calls). Open ${BASE}/bench/${run.id} to watch it live.`);
  await watch(run.id);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
