import { db } from "@/lib/server/db";
import { kick } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** SSE: ingestion progress. Emits `progress` events until the job is done/failed. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  kick();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let last = "";
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = () => {
        const job = db().jobs.find((j) => j.id === id);
        if (!job) { send("error", { message: "Job not found" }); cleanup(); return; }
        const snapshot = JSON.stringify([job.status, job.progress, job.error]);
        if (snapshot !== last) { last = snapshot; send("progress", { status: job.status, progress: job.progress, error: job.error, attempts: job.attempts }); }
        if (job.status === "done" || job.status === "failed") { send("end", { status: job.status }); cleanup(); }
      };
      const timer = setInterval(tick, 400);
      const cleanup = () => { clearInterval(timer); try { controller.close(); } catch { /* closed */ } };
      req.signal.addEventListener("abort", cleanup);
      tick();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
