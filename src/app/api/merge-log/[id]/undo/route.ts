import { undoMerge } from "@/lib/server/library";
import { fail, json } from "@/lib/server/teachers";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Ctx) {
  try {
    const entry = undoMerge((await params).id);
    return json({ ok: true, id: entry.id });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
