import { answer } from "@/lib/server/answer";
import { fail } from "@/lib/server/teachers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** SSE stream; events: route, token, tool, citation, meter, robot_state, done, error. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { content } = (await req.json().catch(() => ({}))) as { content?: string };
  const question = content?.trim().slice(0, 4000);
  if (!question) return fail("Empty message");
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of answer(id, question)) {
          if (req.signal.aborted) break;
          controller.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
        }
      } catch (err) {
        console.error("[chat] stream failed", err);
        controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
