import { db, syncDb } from "@/lib/server/db";
import { kick, workingHere } from "@/lib/server/jobs";
import { hosted } from "@/lib/server/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/**
 * SSE: ingestion progress. Emits `progress` events until the job is done/failed.
 * Hosted, this request is also where the work runs: one time slice per connection. When the slice
 * is used up the stream sends `pause` and the browser reconnects, which starts the next slice.
 */
export async function GET(req: Request, { params }: Ctx) {
  await syncDb();
  const { id } = await params;
  const work = kick();
  const enc = new TextEncoder();
  const opened = Date.now();
  const stream = new ReadableStream({
    start(controller) {
      let last = "", closed = false, lastSync = Date.now(), syncing = false, sliceDone = false;
      const send = (event: string, data: unknown) => { if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      const tick = () => {
        // Another instance may be doing the work: pick up the progress it saves.
        if (hosted() && !workingHere() && !syncing && Date.now() - lastSync > 2000) {
          syncing = true;
          void syncDb().catch(() => {}).finally(() => { syncing = false; lastSync = Date.now(); });
        }
        const job = db().jobs.find((j) => j.id === id);
        if (!job) { send("error", { message: "Job not found" }); cleanup(); return; }
        const snapshot = JSON.stringify([job.status, job.progress, job.error]);
        if (snapshot !== last) { last = snapshot; send("progress", { status: job.status, progress: job.progress, error: job.error, attempts: job.attempts }); }
        if (job.status === "done" || job.status === "failed") { send("end", { status: job.status }); cleanup(); return; }
        // Slice used up (job back in the queue), or this request is getting old: let the browser reconnect.
        if (hosted() && ((sliceDone && job.status === "queued") || Date.now() - opened > 240_000)) { send("pause", {}); cleanup(); }
      };
      const timer = setInterval(tick, 400);
      const cleanup = () => { if (closed) return; closed = true; clearInterval(timer); try { controller.close(); } catch { /* closed */ } };
      req.signal.addEventListener("abort", cleanup);
      void work.then(() => { sliceDone = true; });
      tick();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
