import { db } from "@/lib/server/db";
import { topicTree } from "@/lib/server/library";
import { fail, getTeacher, json } from "@/lib/server/teachers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const log = db().merge_log.filter((m) => m.teacher_id === t.id).slice(-60).reverse()
    .map(({ snapshot, candidate, ...rest }) => ({ ...rest, candidate_title: candidate?.title ?? null, snapshot_titles: snapshot.topics.map((x) => x.title) }));
  return json({ ...topicTree(t.id), merge_log: log });
}
