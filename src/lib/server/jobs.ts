import "server-only";
import { db, now, save, uid } from "./db";
import { ingestSource } from "./ingest/pipeline";
import { buildTiers } from "./ingest/tiers";
import { describeAiError } from "../ai/provider";
import type { Job, JobProgress } from "../types";

/**
 * In-process job queue backed by the jobs table (same shape as the plan's Postgres
 * `jobs` table). One job runs at a time; failures retry up to 3 attempts with backoff.
 */
const MAX_ATTEMPTS = 3;
type G = typeof globalThis & { __roboprofRunner?: { running: boolean; booted: boolean } };
const g = globalThis as G;
const state = (g.__roboprofRunner ??= { running: false, booted: false });

export function enqueue(type: Job["type"], payload: Job["payload"]): Job {
  const job: Job = {
    id: uid(), type, payload, status: "queued", attempts: 0, error: null,
    progress: { stage: "queued", pct: 0, message: "Waiting in the inbox tray…" },
    created_at: now(), updated_at: now(),
  };
  db().jobs.push(job);
  save();
  kick();
  return job;
}

export function kick() {
  if (!state.booted) {
    state.booted = true;
    // Jobs interrupted by a server restart go back to the queue.
    for (const j of db().jobs) if (j.status === "running") j.status = "queued";
  }
  if (state.running) return;
  state.running = true;
  void loop().finally(() => { state.running = false; });
}

async function loop() {
  for (;;) {
    const job = db().jobs.find((j) => j.status === "queued");
    if (!job) return;
    await run(job);
  }
}

async function run(job: Job) {
  const d = db();
  job.status = "running";
  job.attempts++;
  job.error = null;
  const progress = (p: Partial<JobProgress>) => {
    job.progress = { ...job.progress, ...p };
    job.updated_at = now();
    save();
  };
  try {
    if (job.type === "ingest") {
      const source = d.sources.find((s) => s.id === job.payload.source_id);
      if (!source) throw new Error("Source was deleted");
      const report = await ingestSource(source.id, progress);
      source.status = "ready";
      source.error = null;
      progress({ stage: "done", pct: 100, message: "Filed!", report });
    } else {
      await buildTiers(job.payload.topic_ids ?? [], (done, total, title) =>
        progress({ stage: "tiers", pct: Math.round((done / total) * 100), message: `Rebuilt ${title}` }));
      progress({ stage: "done", pct: 100, message: "Rebuilt." });
    }
    job.status = "done";
  } catch (err) {
    const message = describeAiError(err);
    console.error(`[jobs] ${job.type} ${job.id} failed (attempt ${job.attempts}):`, err);
    job.error = message;
    const retryable = job.attempts < MAX_ATTEMPTS && !/unsupported|no readable text|scanned|too large|not found|deleted|rejected|daily limit/i.test(message);
    if (retryable) {
      job.status = "queued";
      progress({ stage: "retry", message: `Hiccup: ${message} — retrying (${job.attempts}/${MAX_ATTEMPTS})…` });
      await new Promise((r) => setTimeout(r, 2000 * job.attempts));
    } else {
      job.status = "failed";
      progress({ stage: "failed", message });
      const source = d.sources.find((s) => s.id === job.payload.source_id);
      if (source) { source.status = "failed"; source.error = message; }
    }
  }
  job.updated_at = now();
  save(true);
}
