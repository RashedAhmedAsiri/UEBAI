import { fail, getTeacher, json } from "@/lib/server/teachers";
import { oneShot } from "@/lib/server/answer";
import { greetingPrompt } from "@/lib/ai/prompts";
import { describeAiError } from "@/lib/ai/provider";
import { PersonalitySchema } from "@/lib/schemas";
import { syncDb } from "@/lib/server/db";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * One-off in-character line: the Power On greeting (kind=greeting) or the
 * Personality Lab preview chat (kind=preview, with an unsaved personality draft).
 */
export async function POST(req: Request, { params }: Ctx) {
  await syncDb();
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const body = (await req.json().catch(() => ({}))) as {
    kind?: "greeting" | "preview";
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    personality?: unknown;
  };
  let teacher = t;
  if (body.personality) {
    const p = PersonalitySchema.safeParse(body.personality);
    if (!p.success) return fail("Invalid personality draft");
    teacher = { ...t, personality: p.data };
  }
  try {
    const prompt = body.kind === "preview" ? (body.message || "Say hi!").slice(0, 500) : greetingPrompt();
    const history = (body.history ?? []).slice(-6).filter((m) => m.content && (m.role === "user" || m.role === "assistant"));
    if (history[0]?.role === "assistant") history.shift();
    const text = await oneShot(teacher, prompt, history);
    return json({ text });
  } catch (err) {
    return fail(describeAiError(err), 502);
  }
}
