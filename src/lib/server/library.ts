import "server-only";
import { db, now, removeWhere, save, uid } from "./db";
import { enqueue } from "./jobs";
import { arabicRefs, buildPassages, notesInArabic, refreshSourceRefs, topicParagraphs } from "./ingest/tiers";
import { completeJson, isLive, complete } from "../ai/provider";
import { studyNotesPrompt } from "../ai/prompts";
import { LEVEL_TEXT } from "../ai/personality";
import { relabelRefs } from "../ingest/merge";
import { Bm25, estimateTokens, slugify } from "../text";
import type { MergeLogEntry, Topic } from "../types";

export function topicTree(teacherId: string) {
  const d = db();
  const units = d.units.filter((u) => u.teacher_id === teacherId).sort((a, b) => a.order_index - b.order_index);
  const topics = d.topics.filter((t) => t.teacher_id === teacherId);
  const sources = d.sources.filter((s) => s.teacher_id === teacherId);
  const passages = d.passages.filter((p) => p.teacher_id === teacherId);
  const messages = d.messages.filter((m) => d.conversations.some((c) => c.id === m.conversation_id && c.teacher_id === teacherId));
  return {
    units,
    topics: topics.map((t) => ({ ...t, paragraph_ids: undefined, passage_count: passages.filter((p) => p.topic_id === t.id).length })),
    links: d.topic_links.filter((l) => topics.some((t) => t.id === l.topic_a)),
    stats: {
      pages: sources.filter((s) => s.status === "ready").reduce((n, s) => n + s.pages, 0),
      topics: topics.length,
      merges: d.merge_log.filter((m) => m.teacher_id === teacherId && m.action === "merge" && !m.undone).length,
      tokens_saved: d.teachers.find((t) => t.id === teacherId)?.tokens_saved ?? 0,
      questions: messages.filter((m) => m.role === "user").length,
    },
  };
}

function snapshot(topics: Topic[]): MergeLogEntry["snapshot"] {
  const d = db();
  const ids = new Set(topics.map((t) => t.id));
  return {
    topics: topics.map((t) => structuredClone(t)),
    passages: d.passages.filter((p) => ids.has(p.topic_id)).map((p) => structuredClone(p)),
    links: d.topic_links.filter((l) => ids.has(l.topic_a) || ids.has(l.topic_b)).map((l) => ({ ...l })),
    created_topic_ids: [],
  };
}

function getTopic(id: string) {
  const t = db().topics.find((x) => x.id === id);
  if (!t) throw new Error("Topic not found");
  return t;
}

/** Drag card A onto card B: A's content folds into B (one topic file). */
export function manualMerge(fromId: string, intoId: string) {
  const d = db();
  const from = getTopic(fromId), into = getTopic(intoId);
  if (from.teacher_id !== into.teacher_id || from.id === into.id) throw new Error("Cannot merge these topics");
  const entry: MergeLogEntry = {
    id: uid(), teacher_id: into.teacher_id, action: "manual_merge", from_topic_ids: [from.id], into_topic_id: into.id,
    reason: `Merged "${from.title}" into "${into.title}" by hand.`, undone: false,
    snapshot: snapshot([from, into, ...d.topics.filter((t) => t.parent_topic_id === from.id)]), created_at: now(),
  };
  into.paragraph_ids = [...new Set([...into.paragraph_ids, ...from.paragraph_ids])];
  into.aliases = [...new Set([...into.aliases, from.title, ...from.aliases])].filter((a) => a !== into.title);
  into.dirty = true;
  // Children and links of the old topic move to the survivor.
  for (const t of d.topics) if (t.parent_topic_id === from.id) t.parent_topic_id = into.id;
  for (const l of d.topic_links) { if (l.topic_a === from.id) l.topic_a = into.id; if (l.topic_b === from.id) l.topic_b = into.id; }
  removeWhere(d.topic_links, (l) => l.topic_a === l.topic_b);
  removeWhere(d.passages, (p) => p.topic_id === from.id);
  removeWhere(d.topics, (t) => t.id === from.id);
  d.merge_log.push(entry);
  save();
  return enqueue("rebuild", { teacher_id: into.teacher_id, topic_ids: [into.id] });
}

/** Split one topic into N sibling topics (titles given by the user or suggested). */
export async function splitTopic(topicId: string, titles: string[]) {
  const d = db();
  const topic = getTopic(topicId);
  const clean = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, 8);
  if (clean.length < 2) throw new Error("Give at least two subtopic titles");
  const paras = topicParagraphs(topic);
  const assignment = new Map<string, number>();
  if (isLive() && paras.length) {
    const listing = paras.map((p, i) => `[${i}] ${p.text.slice(0, 300)}`).join("\n");
    const { data } = await completeJson<{ assign?: number[] }>({
      role: "digest", maxTokens: 4000,
      messages: [{ role: "user", content: `Assign each numbered paragraph to one of these subtopics (0-based index): ${clean.map((t, i) => `${i}=${t}`).join(", ")}.\nReturn JSON only: {"assign": [subtopicIndex for paragraph 0, for paragraph 1, ...]}\n<paragraphs>\n${listing}\n</paragraphs>` }],
    });
    (data.assign ?? []).forEach((a, i) => { if (paras[i] && Number.isInteger(a) && a >= 0 && a < clean.length) assignment.set(paras[i].id, a); });
  }
  const index = new Bm25(clean.map((t, i) => ({ id: String(i), text: t })));
  paras.forEach((p, i) => {
    if (assignment.has(p.id)) return;
    const hit = index.search(p.text, 1)[0];
    assignment.set(p.id, hit ? Number(hit.id) : Math.min(clean.length - 1, Math.floor((i / paras.length) * clean.length)));
  });
  const entry: MergeLogEntry = {
    id: uid(), teacher_id: topic.teacher_id, action: "split", from_topic_ids: [topic.id], into_topic_id: null,
    reason: `Split "${topic.title}" into ${clean.join(", ")}.`, undone: false,
    snapshot: snapshot([topic, ...d.topics.filter((t) => t.parent_topic_id === topic.id)]), created_at: now(),
  };
  const created: Topic[] = clean.map((title, i) => ({
    ...structuredClone(topic), id: uid(), title, aliases: [], keywords: [], card_summary: "", notes_md: "", notes_tokens: 0,
    notes_user_edited: false, dirty: true, version: 0, created_at: now(), updated_at: now(),
    paragraph_ids: paras.filter((p) => assignment.get(p.id) === i).map((p) => p.id),
  }));
  entry.snapshot.created_topic_ids = created.map((t) => t.id);
  for (const t of d.topics) if (t.parent_topic_id === topic.id) t.parent_topic_id = created[0].id;
  removeWhere(d.topic_links, (l) => l.topic_a === topic.id || l.topic_b === topic.id);
  for (let i = 1; i < created.length; i++) d.topic_links.push({ topic_a: created[0].id, topic_b: created[i].id, kind: "related" });
  removeWhere(d.passages, (p) => p.topic_id === topic.id);
  removeWhere(d.topics, (t) => t.id === topic.id);
  d.topics.push(...created);
  d.merge_log.push(entry);
  save();
  return enqueue("rebuild", { teacher_id: topic.teacher_id, topic_ids: created.map((t) => t.id) });
}

/** Undo any logged action, restoring the previous state. */
export function undoMerge(entryId: string) {
  const d = db();
  const entry = d.merge_log.find((m) => m.id === entryId);
  if (!entry || entry.undone) throw new Error("Nothing to undo");
  const rebuild: string[] = [];

  if (entry.action === "merge" && entry.candidate) {
    // Ingestion merge: pull the candidate's paragraphs back out into their own topic.
    const into = d.topics.find((t) => t.id === entry.into_topic_id);
    const before = entry.snapshot.topics[0];
    const laterChanges = d.merge_log.some((m) => m.created_at > entry.created_at && !m.undone && (m.into_topic_id === entry.into_topic_id || m.from_topic_ids.includes(entry.into_topic_id!)));
    if (into) {
      if (!laterChanges && before) {
        Object.assign(into, structuredClone(before), { updated_at: now() });
        removeWhere(d.passages, (p) => p.topic_id === into.id);
        d.passages.push(...entry.snapshot.passages.map((p) => structuredClone(p)));
      } else {
        const out = new Set(entry.candidate.paragraph_ids);
        into.paragraph_ids = into.paragraph_ids.filter((id) => !out.has(id));
        into.aliases = into.aliases.filter((a) => a !== entry.candidate!.title);
        into.dirty = true;
        rebuild.push(into.id);
      }
    }
    const t: Topic = {
      id: uid(), teacher_id: entry.teacher_id, unit_id: entry.candidate.unit_id, parent_topic_id: null,
      title: entry.candidate.title, aliases: entry.candidate.aliases, keywords: [], card_summary: entry.candidate.description,
      notes_md: "", notes_tokens: 0, notes_user_edited: false, paragraph_ids: entry.candidate.paragraph_ids, source_refs: [],
      dirty: true, version: 0, created_at: now(), updated_at: now(),
    };
    d.topics.push(t);
    rebuild.push(t.id);
  } else {
    // Exact restore: remove topics the action created, put back the snapshot.
    const created = new Set(entry.snapshot.created_topic_ids);
    if (entry.action === "manual_merge" || entry.action === "split") {
      for (const t of entry.snapshot.topics) created.add(t.id);
      if (entry.into_topic_id) created.add(entry.into_topic_id);
    }
    removeWhere(d.passages, (p) => created.has(p.topic_id) && entry.action !== "related" && entry.action !== "subtopic");
    if (entry.action === "related") {
      removeWhere(d.topic_links, (l) => (l.topic_a === entry.into_topic_id && entry.from_topic_ids.includes(l.topic_b)));
    } else if (entry.action === "subtopic") {
      for (const snap of entry.snapshot.topics) {
        const t = d.topics.find((x) => x.id === snap.id);
        if (t) t.parent_topic_id = snap.parent_topic_id;
      }
      for (const id of entry.from_topic_ids) {
        const t = d.topics.find((x) => x.id === id);
        if (t && t.parent_topic_id === entry.into_topic_id) t.parent_topic_id = null;
      }
    } else {
      removeWhere(d.topics, (t) => created.has(t.id));
      removeWhere(d.topic_links, (l) => created.has(l.topic_a) || created.has(l.topic_b));
      d.topics.push(...entry.snapshot.topics.map((t) => structuredClone(t)));
      d.passages.push(...entry.snapshot.passages.map((p) => structuredClone(p)));
      d.topic_links.push(...entry.snapshot.links.map((l) => ({ ...l })));
    }
  }
  entry.undone = true;
  save();
  if (rebuild.length) enqueue("rebuild", { teacher_id: entry.teacher_id, topic_ids: rebuild });
  return entry;
}

export function deleteTopic(topicId: string) {
  const d = db();
  const t = getTopic(topicId);
  for (const c of d.topics) if (c.parent_topic_id === t.id) c.parent_topic_id = t.parent_topic_id;
  removeWhere(d.passages, (p) => p.topic_id === t.id);
  removeWhere(d.topic_links, (l) => l.topic_a === t.id || l.topic_b === t.id);
  removeWhere(d.topics, (x) => x.id === t.id);
  save();
}

export function updateTopic(topicId: string, patch: { title?: string; notes_md?: string; unit_id?: string | null; unit_title?: string; parent_topic_id?: string | null }) {
  const d = db();
  const t = getTopic(topicId);
  if (patch.title?.trim()) t.title = patch.title.trim();
  if (typeof patch.notes_md === "string" && patch.notes_md !== t.notes_md) {
    t.notes_md = patch.notes_md;
    t.notes_tokens = estimateTokens(patch.notes_md);
    t.notes_user_edited = true;
  }
  if (patch.unit_title?.trim()) {
    let u = d.units.find((x) => x.teacher_id === t.teacher_id && x.title.toLowerCase() === patch.unit_title!.trim().toLowerCase());
    if (!u) {
      u = { id: uid(), teacher_id: t.teacher_id, title: patch.unit_title.trim(), order_index: d.units.filter((x) => x.teacher_id === t.teacher_id).length };
      d.units.push(u);
    }
    t.unit_id = u.id;
  } else if (patch.unit_id !== undefined) t.unit_id = patch.unit_id;
  if (patch.parent_topic_id !== undefined && patch.parent_topic_id !== t.id) t.parent_topic_id = patch.parent_topic_id;
  t.updated_at = now();
  // Drop empty units.
  removeWhere(d.units, (u) => u.teacher_id === t.teacher_id && !d.topics.some((x) => x.unit_id === u.id));
  save();
  return t;
}

/** Produce fresh notes WITHOUT saving, so the UI can diff against user edits. */
export async function proposeNotes(topicId: string): Promise<string> {
  const d = db();
  const topic = getTopic(topicId);
  const teacher = d.teachers.find((t) => t.id === topic.teacher_id)!;
  refreshSourceRefs(topic);
  buildPassages(topic);
  const ar = notesInArabic(teacher);
  if (!isLive()) {
    return `### ${ar ? "الملخص" : "Summary"}\n${topic.card_summary}\n\n### ${ar ? "الملاحظات الأساسية" : "Core notes"}\n` +
      topicParagraphs(topic).slice(0, 12).map((p) => `- ${p.text.split(/(?<=[.!?؟])\s/)[0]} [${d.sources.find((s) => s.id === p.source_id)?.label} ${ar ? "ص." : "p."}${p.page}]`).join("\n");
  }
  const passages = d.passages.filter((p) => p.topic_id === topic.id);
  const order = [...new Set(passages.map((p) => p.source_id))];
  const labels = order.map((id) => d.sources.find((s) => s.id === id)?.label ?? "Source");
  const text = passages.map((p) => `[B${order.indexOf(p.source_id) + 1} p.${p.page_start}]\n${p.text}`).join("\n\n");
  const language = ar ? "Arabic (including all section headings)" : "English";
  const res = await complete({ role: "notes", maxTokens: 6000, messages: [{ role: "user", content: studyNotesPrompt(topic.title, LEVEL_TEXT[teacher.subject.level], language, 2000, order.length, text.slice(0, 160_000)) }] });
  const notes = relabelRefs(res.text.trim(), labels);
  return ar ? arabicRefs(notes) : notes;
}

export function acceptNotes(topicId: string, notes: string) {
  const t = getTopic(topicId);
  t.notes_md = notes;
  t.notes_tokens = estimateTokens(notes);
  t.notes_user_edited = false;
  t.updated_at = now();
  save();
  return t;
}

export function exportMarkdown(topicId: string): { filename: string; body: string } {
  const d = db();
  const t = getTopic(topicId);
  const unit = d.units.find((u) => u.id === t.unit_id)?.title ?? "";
  const teacher = d.teachers.find((x) => x.id === t.teacher_id);
  const ar = teacher ? notesInArabic(teacher) : true;
  const refs = t.source_refs.map((r) => {
    const s = d.sources.find((x) => x.id === r.source_id);
    return `- ${s?.label ?? "Source"} (${s?.filename ?? "?"}), ${ar ? "الصفحات" : "pp."} ${r.page_start}–${r.page_end}`;
  });
  const yaml = (s: string) => JSON.stringify(s);
  const body = [
    "---",
    `title: ${yaml(t.title)}`,
    `unit: ${yaml(unit)}`,
    `aliases: [${t.aliases.map(yaml).join(", ")}]`,
    `keywords: [${t.keywords.map(yaml).join(", ")}]`,
    `summary: ${yaml(t.card_summary)}`,
    "---",
    "",
    `# ${t.title}`,
    "",
    t.notes_md,
    "",
    ar ? "## ملحق — المصادر (المستوى ٣)" : "## Appendix — sources (Tier 3)",
    ...refs,
    "",
  ].join("\n");
  return { filename: `${slugify(t.title)}.md`, body };
}
