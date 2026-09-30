import { db, now, save, uid } from "@/lib/server/db";
import { fail, getTeacher, json } from "@/lib/server/teachers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const conversations = db().conversations.filter((c) => c.teacher_id === t.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return json({ conversations });
}

export async function POST(_: Request, { params }: Ctx) {
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const conversation = { id: uid(), teacher_id: t.id, title: "New lesson", active_topic_ids: [], created_at: now() };
  db().conversations.push(conversation);
  save();
  return json({ conversation }, 201);
}
