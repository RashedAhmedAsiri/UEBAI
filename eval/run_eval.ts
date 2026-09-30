/**
 * Retrieval eval (§19). Runs against a live dev server:
 *   1. creates a teacher, uploads the corpus files, waits for ingestion
 *   2. checks the dedup test (shared topics exist once, with every source attached)
 *   3. asks each question and records topics routed, tokens per answer vs whole-library baseline,
 *      and whether the expected topic / page were cited
 *
 * Usage:  npm run dev   (in another terminal)
 *         npm run eval -- eval/dataset.json
 * Dataset format: { "files": ["samples/a.md", ...], "shared_topics": ["Mammals"], "questions": [{ "q": "...", "topic": "Mammals", "page": 12 }] }
 * For the full §19 run use two overlapping OpenStax books (CC BY 4.0) and ~40 questions.
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.ROBOPROF_URL ?? "http://localhost:3000";
const datasetPath = process.argv[2] ?? "eval/dataset.json";

interface Dataset { files: string[]; shared_topics: string[]; questions: { q: string; topic: string; page?: number }[] }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + url, init);
  const d = await r.json();
  if (!r.ok) throw new Error(`${url}: ${JSON.stringify(d)}`);
  return d as T;
}

async function ask(convId: string, q: string) {
  const r = await fetch(`${BASE}/api/conversations/${convId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: q }) });
  const text = await r.text();
  const events = text.split("\n\n").map((b) => b.split("\n").find((l) => l.startsWith("data: "))).filter(Boolean).map((l) => JSON.parse(l!.slice(6)));
  return {
    topics: events.filter((e) => e.type === "route").flatMap((e) => e.topics.map((t: { title: string }) => t.title)),
    citations: events.filter((e) => e.type === "citation").map((e) => e.citation),
    meter: events.find((e) => e.type === "meter"),
  };
}

async function main() {
  const ds = JSON.parse(fs.readFileSync(datasetPath, "utf8")) as Dataset;
  const { teacher } = await j<{ teacher: { id: string } }>("/api/teachers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: process.env.EVAL_LANG ?? "en" }) });
  await j(`/api/teachers/${teacher.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ knowledge_mode: "files_strict", draft: false }) });
  console.log(`teacher ${teacher.id}`);

  for (const f of ds.files) {
    const fd = new FormData();
    fd.append("file", new Blob([fs.readFileSync(f)]), path.basename(f));
    const up = await j<{ source: { id: string } }>(`/api/teachers/${teacher.id}/sources`, { method: "POST", body: fd });
    await j(`/api/sources/${up.source.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    for (;;) {
      const { sources } = await j<{ sources: { id: string; status: string; error: string | null }[] }>(`/api/teachers/${teacher.id}/sources`);
      const s = sources.find((x) => x.id === up.source.id)!;
      if (s.status === "ready") break;
      if (s.status === "failed") throw new Error(`${f}: ${s.error}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log(`ingested ${f}`);
  }

  const tree = await j<{ topics: { title: string; source_refs: unknown[] }[] }>(`/api/teachers/${teacher.id}/topics`);
  let dedupOk = true;
  for (const name of ds.shared_topics) {
    const hits = tree.topics.filter((t) => t.title.toLowerCase() === name.toLowerCase());
    const ok = hits.length === 1 && hits[0].source_refs.length >= 2;
    dedupOk &&= ok;
    console.log(`dedup ${ok ? "✔" : "✘"} ${name}: ${hits.length} topic(s), ${hits[0]?.source_refs.length ?? 0} source(s)`);
  }

  const { conversation } = await j<{ conversation: { id: string } }>(`/api/teachers/${teacher.id}/conversations`, { method: "POST" });
  let routed = 0, cited = 0, pageOk = 0, tokens = 0, baseline = 0;
  for (const item of ds.questions) {
    const r = await ask(conversation.id, item.q);
    const hit = r.topics.some((t: string) => t.toLowerCase() === item.topic.toLowerCase());
    const cite = r.citations.some((c: { topic_title?: string }) => c.topic_title?.toLowerCase() === item.topic.toLowerCase());
    const page = item.page === undefined || r.citations.some((c: { page?: number }) => c.page === item.page);
    routed += +hit; cited += +cite; pageOk += +page;
    tokens += (r.meter?.tokens_in ?? 0) + (r.meter?.tokens_out ?? 0);
    baseline = r.meter?.baseline ?? baseline;
    console.log(`${hit ? "✔" : "✘"} ${item.q} → ${r.topics.join(", ") || "(none)"}`);
  }
  const n = ds.questions.length || 1;
  console.log("\n=== RESULTS ===");
  console.log(`dedup test:          ${dedupOk ? "PASS" : "FAIL"}`);
  console.log(`routing accuracy:    ${((100 * routed) / n).toFixed(0)}%`);
  console.log(`cited right topic:   ${((100 * cited) / n).toFixed(0)}%`);
  console.log(`citation page ok:    ${((100 * pageOk) / n).toFixed(0)}%  (target ≥ 85%)`);
  console.log(`tokens / answer:     ${Math.round(tokens / n)} vs whole library ${baseline} → ${baseline ? ((100 * tokens) / n / baseline).toFixed(1) : "?"}%  (target ≤ 5% on a real textbook)`);
  console.log("(Answer accuracy vs a whole-book baseline needs an LLM judge and an API key — see docs/PROGRESS.md.)");
}

main().catch((e) => { console.error(e); process.exit(1); });
