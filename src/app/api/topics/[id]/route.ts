import { db } from "@/lib/server/db";
import { deleteTopic, updateTopic } from "@/lib/server/library";
import { fail, json } from "@/lib/server/teachers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const d = db();
  const { id } = await params;
  const topic = d.topics.find((t) => t.id === id);
  if (!topic) return fail("Topic not found", 404);
  const sources = topic.source_refs.map((r) => ({ ...r, label: d.sources.find((s) => s.id === r.source_id)?.label ?? "?", filename: d.sources.find((s) => s.id === r.source_id)?.filename ?? "?" }));
  const related = d.topic_links.filter((l) => l.topic_a === topic.id || l.topic_b === topic.id)
    .map((l) => d.topics.find((t) => t.id === (l.topic_a === topic.id ? l.topic_b : l.topic_a)))
    .filter(Boolean).map((t) => ({ id: t!.id, title: t!.title }));
  const children = d.topics.filter((t) => t.parent_topic_id === topic.id).map((t) => ({ id: t.id, title: t.title }));
  const parent = d.topics.find((t) => t.id === topic.parent_topic_id);
  const passages = d.passages.filter((p) => p.topic_id === topic.id).map((p) => ({ ...p, label: d.sources.find((s) => s.id === p.source_id)?.label ?? "?" }));
  return json({ topic: { ...topic, paragraph_ids: undefined }, sources, related, children, parent: parent ? { id: parent.id, title: parent.title } : null, passages });
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = await req.json();
    return json({ topic: updateTopic((await params).id, body) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    deleteTopic((await params).id);
    return json({ ok: true });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 404);
  }
}
