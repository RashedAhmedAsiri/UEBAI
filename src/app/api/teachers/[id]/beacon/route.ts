import { now, save, syncDb } from "@/lib/server/db";
import { getTeacher } from "@/lib/server/teachers";
import { TeacherPatchSchema } from "@/lib/schemas";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** sendBeacon target: last-chance draft save when the tab closes mid-wizard. */
export async function POST(req: Request, { params }: Ctx) {
  await syncDb();
  const t = getTeacher((await params).id);
  if (!t) return new Response(null, { status: 404 });
  const parsed = TeacherPatchSchema.safeParse(JSON.parse(await req.text()));
  if (parsed.success) {
    Object.assign(t, parsed.data);
    if (parsed.data.personality) { t.name = parsed.data.personality.name; t.title = parsed.data.personality.title; }
    t.updated_at = now();
    save();
  }
  return new Response(null, { status: 204 });
}
