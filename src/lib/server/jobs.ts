import "server-only";
import { after } from "next/server";
import { db, flushDb, holdDb, now, save, syncDb, uid } from "./db";
import { hosted, kv } from "./kv";
import { endSlice, SliceYield, sliceExpired, startSlice } from "./slice";
import { ingestSource } from "./ingest/pipeline";
import { buildTiers } from "./ingest/tiers";
import { describeAiError } from "../ai/provider";
import type { Job, JobProgress } from "../types";

/**
 * In-process job queue backed by the jobs table (same shape as the plan's Postgres
 * `jobs` table). One job runs at a time; failures retry up to 3 attempts with backoff.
 *
 * Hosted (Vercel) there is no long-lived server: work runs in slices of SLICE_MS inside a request
 * (the progress stream, or after() any other request). A Redis lock keeps two instances off the
 * same job; a job that runs out of time saves a checkpoint and continues in the next slice.
 */
const MAX_ATTEMPTS = 3;
const SLICE_MS = hosted() ? Number(process.env.UEBAI_SLICE_SECONDS || 200) * 1000 : Infinity;
const LOCK_MS = 330_000; // longer than any request may run (maxDuration 300 s)
type G = typeof globalThis & { __roboprofRunner?: { running: boolean; booted: boolean; current: Promise<void> | null } };
const g = globalThis as G;
const state = (g.__roboprofRunner ??= { running: false, booted: false, current: null });

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

/** Start working on queued jobs. Hosted: one slice, kept alive with after(); resolves when it ends. */
export function kick(): Promise<void> {
  if (hosted()) {
    if (!state.current) {
      state.current = slice().catch((err) => console.error("[jobs] slice failed:", err)).finally(() => { state.current = null; });
      try { after(() => state.current ?? undefined); } catch { /* not inside a request */ }
    }
    return state.current;
  }
  if (!state.booted) {
    state.booted = true;
    // Jobs interrupted by a server restart go back to the queue.
    for (const j of db().jobs) if (j.status === "running") j.status = "queued";
  }
  if (state.running) return Promise.resolve();
  state.running = true;
  void loop().finally(() => { state.running = false; });
  return Promise.resolve();
}

/** True while this instance is working on a job (hosted). */
export function workingHere(): boolean {
  return state.current !== null;
}

async function loop() {
  for (;;) {
    const job = db().jobs.find((j) => j.status === "queued");
    if (!job) return;
    await run(job);
  }
}

const lockKey = (id: string) => `uebai:lock:job:${id}`;

async function slice() {
  startSlice(SLICE_MS);
  const tried = new Set<string>();
  try {
    while (!sliceExpired()) {
      // "running" without a lock means the instance working on it was stopped: pick it up again.
      const job = db().jobs.find((j) => (j.status === "queued" || j.status === "running") && !tried.has(j.id));
      if (!job) return;
      tried.add(job.id);
      const token = uid();
      if ((await kv("SET", lockKey(job.id), token, "NX", "PX", LOCK_MS)) !== "OK") continue;
      try {
        await flushDb();
        await syncDb(); // the latest copy, now that no one else can work on this job
        const fresh = db().jobs.find((j) => j.id === job.id);
        if (!fresh || fresh.status === "done" || fresh.status === "failed") continue;
        const release = holdDb();
        try { await run(fresh); } finally { release(); }
        await flushDb();
      } finally {
        if ((await kv<string | null>("GET", lockKey(job.id)).catch(() => null)) === token) await kv("DEL", lockKey(job.id)).catch(() => {});
      }
    }
  } finally {
    endSlice();
    await flushDb().catch((err) => console.error("[jobs] save failed:", err));
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
      const report = await ingestSource(source.id, progress, {
        get: () => job.payload.resume,
        set: async (r) => { job.payload.resume = r; save(); await flushDb(); },
      });
      delete job.payload.resume;
      source.status = "ready";
      source.error = null;
      progress({ stage: "done", pct: 100, message: "Filed!", report });
    } else {
      const finished = await buildTiers(job.payload.topic_ids ?? [], (done, total, title) =>
        progress({ stage: "tiers", pct: Math.round((done / total) * 100), message: `Rebuilt ${title}` }), sliceExpired);
      if (!finished) {
        job.payload.topic_ids = (job.payload.topic_ids ?? []).filter((id) => d.topics.some((t) => t.id === id && t.dirty));
        throw new SliceYield();
      }
      progress({ stage: "done", pct: 100, message: "Rebuilt." });
    }
    job.status = "done";
  } catch (err) {
    if (err instanceof SliceYield) {
      // Not a failure: carry on from the checkpoint in the next slice.
      job.status = "queued";
      job.attempts--;
      job.updated_at = now();
      save(true);
      return;
    }
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
