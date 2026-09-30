import type { DB } from "../types";

/**
 * Topics that never got notes and whose paragraphs are all gone — left behind when an ingestion
 * attempt failed after filing topics and the retry re-created the source's paragraphs. They show
 * as "being rewritten…" forever. Removes them (with their passages, links and now-empty units)
 * and returns how many were removed. Topics with notes are never touched.
 */
export function pruneOrphanTopics(d: DB, teacherId?: string): number {
  const live = new Set(d.paragraphs.map((p) => p.id));
  const orphans = new Set(d.topics
    .filter((t) => (!teacherId || t.teacher_id === teacherId) && !t.notes_md && !t.paragraph_ids.some((id) => live.has(id)))
    .map((t) => t.id));
  if (!orphans.size) return 0;
  const touchedUnits = new Set(d.topics.filter((t) => orphans.has(t.id)).map((t) => t.unit_id));
  d.topics = d.topics.filter((t) => !orphans.has(t.id));
  d.passages = d.passages.filter((p) => !orphans.has(p.topic_id));
  d.topic_links = d.topic_links.filter((l) => !orphans.has(l.topic_a) && !orphans.has(l.topic_b));
  for (const t of d.topics) if (t.parent_topic_id && orphans.has(t.parent_topic_id)) t.parent_topic_id = null;
  for (const c of d.conversations) c.active_topic_ids = c.active_topic_ids.filter((id) => !orphans.has(id));
  // Units that only held orphans are empty shelves now.
  const used = new Set(d.topics.map((t) => t.unit_id));
  d.units = d.units.filter((u) => !touchedUnits.has(u.id) || used.has(u.id));
  return orphans.size;
}
