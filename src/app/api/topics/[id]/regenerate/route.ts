import { db } from "@/lib/server/db";
import { acceptNotes, proposeNotes } from "@/lib/server/library";
import { fail, json } from "@/lib/server/teachers";
import { describeAiError } from "@/lib/ai/provider";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Regenerate notes. Returns a proposal (never silently overwrites user edits);
 * POST again with {accept: notes} to save the chosen version.
 */
export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const body = (await req.json().catch(() => ({}))) as { accept?: string };
  try {
    if (typeof body.accept === "string") return json({ topic: acceptNotes(id, body.accept) });
    const proposal = await proposeNotes(id);
    const topic = db().topics.find((t) => t.id === id)!;
    if (!topic.notes_user_edited) return json({ topic: acceptNotes(id, proposal), applied: true });
    return json({ proposal, current: topic.notes_md, applied: false });
  } catch (err) {
    return fail(describeAiError(err));
  }
}
