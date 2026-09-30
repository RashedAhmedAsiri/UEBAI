import { deleteTeacherCascade, db, now, save } from "@/lib/server/db";
import { fail, getTeacher, json, teacherSummary } from "@/lib/server/teachers";
import { TeacherPatchSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const sources = db().sources.filter((s) => s.teacher_id === t.id);
  return json({ teacher: teacherSummary(t), sources });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const parsed = TeacherPatchSchema.safeParse(await req.json());
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const p = parsed.data;
  Object.assign(t, p);
  if (p.personality) {
    t.name = p.personality.name;
    t.title = p.personality.title;
  }
  if (p.wizard_step !== undefined) t.wizard_step = Math.max(t.wizard_step, p.wizard_step);
  t.updated_at = now();
  save();
  return json({ teacher: teacherSummary(t) });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  deleteTeacherCascade(t.id);
  return json({ ok: true });
}
