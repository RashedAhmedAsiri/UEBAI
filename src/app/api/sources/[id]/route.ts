import fs from "node:fs";
import { db, removeWhere, save } from "@/lib/server/db";
import { enqueue } from "@/lib/server/jobs";
import { fail, json } from "@/lib/server/teachers";

type Ctx = { params: Promise<{ id: string }> };

/** Remove a source; its topics lose those paragraphs and are rebuilt (or removed if empty). */
export async function DELETE(_: Request, { params }: Ctx) {
  const d = db();
  const { id } = await params;
  const source = d.sources.find((s) => s.id === id);
  if (!source) return fail("Source not found", 404);
  if (source.status === "queued" || source.status === "extracting" || source.status === "indexing") return fail("Wait until this file finishes processing.");
  const paraIds = new Set(d.paragraphs.filter((p) => p.source_id === source.id).map((p) => p.id));
  const rebuild: string[] = [];
  for (const t of d.topics.filter((t) => t.teacher_id === source.teacher_id)) {
    const before = t.paragraph_ids.length;
    t.paragraph_ids = t.paragraph_ids.filter((id) => !paraIds.has(id));
    if (t.paragraph_ids.length !== before) { t.dirty = true; rebuild.push(t.id); }
  }
  const empty = new Set(d.topics.filter((t) => rebuild.includes(t.id) && !t.paragraph_ids.length).map((t) => t.id));
  removeWhere(d.topics, (t) => empty.has(t.id));
  removeWhere(d.topic_links, (l) => empty.has(l.topic_a) || empty.has(l.topic_b));
  removeWhere(d.passages, (p) => p.source_id === source.id || empty.has(p.topic_id));
  removeWhere(d.paragraphs, (p) => p.source_id === source.id);
  removeWhere(d.units, (u) => u.teacher_id === source.teacher_id && !d.topics.some((t) => t.unit_id === u.id));
  removeWhere(d.sources, (s) => s.id === source.id);
  try { fs.rmSync(source.storage_path, { force: true }); } catch { /* ignore */ }
  save();
  const remaining = rebuild.filter((id) => !empty.has(id));
  if (remaining.length) enqueue("rebuild", { teacher_id: source.teacher_id, topic_ids: remaining });
  return json({ ok: true, removed_topics: empty.size, rebuilding: remaining.length });
}
