/**
 * Free retrieval check from the command line (no answers generated, no AI quota used):
 * does the material each condition gives the model contain the answer-key facts and page,
 * how big is it, and how much of it is repeated wording?
 * Runs on the local data directly (stop the site first if you are adding books at the same time).
 *
 *   npx tsx --conditions=react-server eval/retrieval_check.ts [biology1.json] [--exact] [--all-sources] [--teacher <id>]
 *
 * --exact        adds Google's official token counts (free countTokens; needs GEMINI_API_KEY)
 * --all-sources  uses every book of the teacher (e.g. textbook + teacher's slides), not only the set's book
 * The report is saved in data/bench/retrieval/ and shown on the Proof Lab page.
 */
import fs from "node:fs";
import path from "node:path";
import { RETRIEVAL_DIR, retrievalCheck, retrievalFile, saveRetrieval } from "../src/lib/server/bench/retrieval";
import { summarizeRetrieval } from "../src/lib/bench/stats";
import { db } from "../src/lib/server/db";

function loadEnv() {
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^(GEMINI_API_KEY|DEEPSEEK_API_KEY)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* no .env.local */ }
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const dataset = argv.find((a) => a.endsWith(".json")) ?? "biology1.json";
  const exact = argv.includes("--exact") && process.env.GEMINI_API_KEY ? "gemini-3.6-flash" : null;
  const allSources = argv.includes("--all-sources");
  const teacherArg = argv[argv.indexOf("--teacher") + 1];
  const ds = JSON.parse(fs.readFileSync(path.join("eval", "bench", dataset), "utf8")) as { book_hint?: string };
  const teacher = argv.includes("--teacher") ? teacherArg
    : db().teachers.find((t) => db().sources.some((s) => s.teacher_id === t.id && s.status === "ready" && (!ds.book_hint || s.filename.includes(ds.book_hint))))?.id;
  if (!teacher) throw new Error("No teacher has this book yet");
  const report = await retrievalCheck(teacher, dataset, 8192, exact, allSources);
  saveRetrieval(dataset, report);
  const out = path.join(RETRIEVAL_DIR, retrievalFile(dataset, report.scope));

  const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
  console.log(`\n${report.dataset} — ${report.book.labels.join(" + ")}: ${report.book.pages} pages, ${report.book.topics} topic cards${allSources ? " (all sources)" : ""}`);
  console.log(`Whole library: ~${report.book.full_tokens_est.toLocaleString()} tokens (estimate)${report.book.full_tokens_exact ? `, ${report.book.full_tokens_exact.toLocaleString()} exact` : ""}`);
  console.table(summarizeRetrieval(report).map((s) => ({
    condition: s.condition, questions: s.questions,
    "facts in material": pct(s.coverage), "all facts": pct(s.all_facts), "answer page": pct(s.page),
    "repeated wording": pct(s.repeated),
    "median tokens (est)": Math.round(s.tokens_est), "median tokens (exact)": Number.isFinite(s.tokens_exact) ? Math.round(s.tokens_exact) : "—",
  })));
  for (const r of report.rows.filter((x) => x.category !== "unanswerable")) {
    const u = r.cells.uebai;
    if (u.facts_found < u.facts_findable) console.log(`  UEBAI missing facts: ${r.question_id} (${u.facts_found}/${u.facts_findable}) — cards: ${u.topics?.join(" | ")}`);
  }
  console.log(`\nSaved ${out}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
