import { fail, json } from "@/lib/server/teachers";
import { control, deleteRun, getRun, type RunAction } from "@/lib/server/bench/runner";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  return run ? json({ run }) : fail("Run not found", 404);
}

/** Body: { action: "pause" | "resume" | "cancel" | "judge" | "retry", judge_model?: string | null } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; judge_model?: string | null };
  if (!["pause", "resume", "cancel", "judge", "retry"].includes(body.action ?? "")) return fail("Unknown action");
  try {
    return json({ run: control(id, body.action as RunAction, body.judge_model) });
  } catch (e) {
    return fail((e as Error).message, 404);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteRun(id);
  return json({ ok: true });
}
