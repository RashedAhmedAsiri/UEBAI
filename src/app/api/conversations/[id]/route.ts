import { db, removeWhere, save, syncDb } from "@/lib/server/db";
import { fail, json } from "@/lib/server/teachers";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  await syncDb();
  const d = db();
  const { id } = await params;
  const conversation = d.conversations.find((c) => c.id === id);
  if (!conversation) return fail("Conversation not found", 404);
  const messages = d.messages.filter((m) => m.conversation_id === conversation.id);
  const active = d.topics.filter((t) => conversation.active_topic_ids.includes(t.id)).map((t) => ({ id: t.id, title: t.title }));
  return json({ conversation, messages, active_topics: active });
}

export async function DELETE(_: Request, { params }: Ctx) {
  await syncDb();
  const d = db();
  const id = (await params).id;
  removeWhere(d.messages, (m) => m.conversation_id === id);
  removeWhere(d.conversations, (c) => c.id === id);
  save();
  return json({ ok: true });
}
