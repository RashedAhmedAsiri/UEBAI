import "server-only";
import { db, now, pruneOrphanTopics, save, uid } from "../db";
import { extract } from "./extract";
import { buildTiers, pMap } from "./tiers";
import { cleanPages, renderSection, sectionTokens, toParagraphs, toSections, type Section } from "../../ingest/structure";
import { decideBySimilarity, isRelation, offlineJudge, type Relation } from "../../ingest/merge";
import { completeJson, isLive } from "../../ai/provider";
import { mergeJudgePrompt, topicDetectionPrompt } from "../../ai/prompts";
import { LEVEL_TEXT } from "../../ai/personality";
import { normalizeForSearch, sentences, topicSimilarity } from "../../text";
import type { IngestReport, JobProgress, MergeLogEntry, Paragraph, Source, Teacher, Topic } from "../../types";

interface Candidate {
  title: string;
  aliases: string[];
  description: string;
  unit: string;
  paragraphIds: string[];
}

type Progress = (p: Partial<JobProgress>) => void;

export async function ingestSource(sourceId: string, progress: Progress): Promise<IngestReport> {
  const d = db();
  const source = d.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error("Source not found");
  const teacher = d.teachers.find((t) => t.id === source.teacher_id)!;

  // Restart-safe: drop anything a previous failed attempt left behind for this source — its
  // paragraphs, and the topics it filed that never got notes (they'd spin "being rewritten…" forever).
  d.paragraphs = d.paragraphs.filter((p) => p.source_id !== sourceId);
  pruneOrphanTopics(d, teacher.id);

  // 2. Extract
  source.status = "extracting";
  progress({ stage: "extract", pct: 5, message: `Reading ${source.filename}…` });
  const ex = await extract(source.storage_path, source.mime);
  source.pages = ex.pageCount;

  // 3. Clean  4. Structural split (numbered paragraphs, page markers)
  progress({ stage: "clean", pct: 15, message: `Cleaning ${ex.pageCount} pages…` });
  const pages = cleanPages(ex.pages);
  const { paragraphs } = toParagraphs(pages);
  if (!paragraphs.length) throw new Error("No readable text was found in this file.");

  // 5. Exact dedup against paragraphs already stored for this teacher
  const existingHashes = new Set(d.paragraphs.filter((p) => p.teacher_id === teacher.id).map((p) => p.norm_hash));
  const kept: Paragraph[] = [];
  let skipped = 0;
  for (const p of paragraphs) {
    if (existingHashes.has(p.norm_hash)) { skipped++; continue; }
    existingHashes.add(p.norm_hash);
    kept.push({ id: uid(), teacher_id: teacher.id, source_id: source.id, idx: p.idx, page: p.page, text: p.text, norm_hash: p.norm_hash, heading: p.heading });
  }
  d.paragraphs.push(...kept);
  save();
  if (!kept.length) {
    progress({ stage: "dedup", pct: 100, message: "Everything in this file is already in the library." });
    return { pages: ex.pageCount, topics: 0, new_topics: 0, merged: 0, new_units: 0, skipped_paragraphs: skipped };
  }

  // 6. Topic detection
  source.status = "indexing";
  const sections = toSections(kept.map((p) => ({ ...p })), source.label);
  progress({ stage: "topics", pct: 25, message: `Finding topics in ${sections.length} sections…` });
  const byIdx = new Map(kept.map((p) => [p.idx, p]));
  const candidates = isLive()
    ? await detectTopicsLive(sections, teacher, byIdx, (done, total) =>
        progress({ stage: "topics", pct: 25 + Math.round((done / total) * 30), message: `Finding topics… (${done}/${total})` }))
    : detectTopicsOffline(sections, source);

  // 7. Canonicalize & merge
  progress({ stage: "merge", pct: 58, message: `Filing ${candidates.length} topics…` });
  const unitsBefore = d.units.filter((u) => u.teacher_id === teacher.id).length;
  const { dirty, merged, created } = await canonicalize(candidates, teacher, source, (done) =>
    progress({ stage: "merge", pct: 58 + Math.round((done / candidates.length) * 12), message: `Filing topics… (${done}/${candidates.length})` }));
  save();

  // 8. Build tiers for dirty topics only
  progress({ stage: "tiers", pct: 70, message: `Writing study notes for ${dirty.length} topics…` });
  await buildTiers(dirty, (done, total, title) =>
    progress({ stage: "tiers", pct: 70 + Math.round((done / total) * 28), message: `Notes: ${title} (${done}/${total})` }));

  const report: IngestReport = {
    pages: ex.pageCount,
    topics: dirty.length,
    new_topics: created,
    merged,
    new_units: d.units.filter((u) => u.teacher_id === teacher.id).length - unitsBefore,
    skipped_paragraphs: skipped,
  };
  return report;
}

/** Batch sections into ~6k-token prompts, run topic detection with the small model. */
async function detectTopicsLive(sections: Section[], teacher: Teacher, byIdx: Map<number, Paragraph>, onProgress: (d: number, t: number) => void): Promise<Candidate[]> {
  const batches: Section[][] = [[]];
  let size = 0;
  for (const s of sections) {
    const t = sectionTokens(s);
    if (size + t > 6000 && batches[batches.length - 1].length) { batches.push([]); size = 0; }
    batches[batches.length - 1].push(s); size += t;
  }
  let done = 0;
  const subject = teacher.subject.name || "general";
  const level = LEVEL_TEXT[teacher.subject.level];
  const results = await pMap(batches, 4, async (batch) => {
    const text = batch.map(renderSection).join("\n\n");
    const { data } = await completeJson<unknown>({ role: "digest", maxTokens: 4000, messages: [{ role: "user", content: topicDetectionPrompt(subject, level, text) }] });
    onProgress(++done, batches.length);
    const list = Array.isArray(data) ? data : [];
    const inBatch = batch.flatMap((s) => s.paragraphs.map((p) => p.idx));
    const covered = new Set<number>();
    const cands: Candidate[] = [];
    for (const raw of list as Record<string, unknown>[]) {
      if (typeof raw?.title !== "string" || !raw.title.trim()) continue;
      const ids: string[] = [];
      for (const range of (Array.isArray(raw.paragraphs) ? raw.paragraphs : []) as unknown[]) {
        const [a, b] = Array.isArray(range) ? range.map(Number) : [Number(range), Number(range)];
        if (!Number.isFinite(a)) continue;
        for (let i = a; i <= (Number.isFinite(b) ? b : a); i++) {
          const p = byIdx.get(i);
          if (p && inBatch.includes(i)) { ids.push(p.id); covered.add(i); }
        }
      }
      if (!ids.length) continue;
      cands.push({
        title: raw.title.trim(),
        aliases: Array.isArray(raw.aliases) ? (raw.aliases as unknown[]).filter((x): x is string => typeof x === "string") : [],
        description: typeof raw.description === "string" ? raw.description : "",
        unit: typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : batch[0].unit ?? batch[0].title,
        paragraphIds: ids,
      });
    }
    // Paragraphs the model skipped: attach to the candidate covering the nearest earlier paragraph.
    const idxOf = new Map([...byIdx.values()].map((x) => [x.id, x.idx]));
    for (const i of inBatch) {
      if (covered.has(i) || !cands.length) continue;
      const p = byIdx.get(i)!;
      let best = cands[0], bestDist = Infinity;
      for (const c of cands) for (const id of c.paragraphIds) {
        const q = idxOf.get(id);
        if (q !== undefined && Math.abs(q - i) < bestDist) { bestDist = Math.abs(q - i); best = c; }
      }
      if (bestDist <= 3) best.paragraphIds.push(p.id);
    }
    return cands;
  });
  return results.flat();
}

/** Demo mode: one topic per heading section (consecutive same-title sections combined). */
function detectTopicsOffline(sections: Section[], source: Source): Candidate[] {
  const out: Candidate[] = [];
  for (const s of sections) {
    const last = out[out.length - 1];
    const ids = s.paragraphs.map((p) => (p as unknown as { id: string }).id);
    if (last && last.title === s.title) { last.paragraphIds.push(...ids); continue; }
    out.push({
      title: s.title,
      aliases: [],
      description: sentences(s.paragraphs.map((p) => p.text).join(" ")).slice(0, 1).join(" "),
      unit: s.unit ?? source.label,
      paragraphIds: ids,
    });
  }
  return out;
}

function findOrCreateUnit(teacherId: string, title: string): string {
  const d = db();
  const norm = normalizeForSearch(title);
  const existing = d.units.find((u) => u.teacher_id === teacherId && normalizeForSearch(u.title) === norm);
  if (existing) return existing.id;
  const id = uid();
  d.units.push({ id, teacher_id: teacherId, title, order_index: d.units.filter((u) => u.teacher_id === teacherId).length });
  return id;
}

function newTopic(teacherId: string, c: Candidate, unitId: string | null, parentId: string | null = null): Topic {
  const t: Topic = {
    id: uid(), teacher_id: teacherId, unit_id: unitId, parent_topic_id: parentId,
    title: c.title, aliases: c.aliases, keywords: [], card_summary: c.description,
    notes_md: "", notes_tokens: 0, notes_user_edited: false,
    paragraph_ids: [...new Set(c.paragraphIds)], source_refs: [], dirty: true, version: 0,
    created_at: now(), updated_at: now(),
  };
  db().topics.push(t);
  return t;
}

function depthOf(topic: Topic): number {
  let depth = 1, cur = topic;
  const byId = new Map(db().topics.map((t) => [t.id, t]));
  while (cur.parent_topic_id && byId.get(cur.parent_topic_id)) { cur = byId.get(cur.parent_topic_id)!; depth++; }
  return depth;
}

async function judge(existing: Topic, c: Candidate, sourceLabel: string): Promise<{ relation: Relation; canonical?: string; reason: string }> {
  const { data } = await completeJson<{ relation?: string; canonical_title?: string; reason?: string }>({
    role: "digest", maxTokens: 400,
    messages: [{ role: "user", content: mergeJudgePrompt({ title: existing.title, aliases: existing.aliases, summary: existing.card_summary }, c, sourceLabel) }],
  });
  return { relation: isRelation(data.relation) ? data.relation : "DIFFERENT", canonical: data.canonical_title, reason: data.reason ?? "" };
}

/** §9.5 — merge candidates into the teacher's existing topics (and into each other). */
async function canonicalize(candidates: Candidate[], teacher: Teacher, source: Source, onProgress: (done: number) => void) {
  const d = db();
  const dirty = new Set<string>();
  let merged = 0, created = 0, done = 0;
  for (const c of candidates) {
    const unitId = findOrCreateUnit(teacher.id, c.unit);
    const pool = d.topics.filter((t) => t.teacher_id === teacher.id);
    let best: Topic | null = null, bestSim = 0;
    for (const t of pool) {
      const sim = topicSimilarity(c, { title: t.title, aliases: t.aliases, description: t.card_summary });
      if (sim > bestSim) { bestSim = sim; best = t; }
    }
    const decision = decideBySimilarity(bestSim);
    let relation: Relation = "DIFFERENT", reason = "No similar topic in the library.", canonical: string | undefined;
    if (best && decision !== "new") {
      if (isLive()) {
        const j = await judge(best, c, source.label);
        relation = j.relation; reason = j.reason; canonical = j.canonical;
        // A ≥0.90 match only needs a quick confirmation: anything but a clear "different" is a merge.
        if (decision === "confirm_merge" && relation !== "DIFFERENT" && relation !== "RELATED") relation = "SAME";
      } else {
        relation = offlineJudge(bestSim, decision);
        reason = `Title/summary similarity ${bestSim.toFixed(2)}.`;
      }
    }

    const log = (action: MergeLogEntry["action"], from: string[], into: string | null, snapshotTopics: Topic[], createdIds: string[], candidate?: MergeLogEntry["candidate"]) =>
      d.merge_log.push({
        id: uid(), teacher_id: teacher.id, action, from_topic_ids: from, into_topic_id: into, reason, undone: false,
        snapshot: {
          topics: snapshotTopics.map((t) => structuredClone(t)),
          passages: d.passages.filter((p) => snapshotTopics.some((t) => t.id === p.topic_id)).map((p) => structuredClone(p)),
          links: [], created_topic_ids: createdIds,
        },
        candidate, created_at: now(),
      });

    if (best && relation === "SAME") {
      const snap = structuredClone(best);
      best.paragraph_ids = [...new Set([...best.paragraph_ids, ...c.paragraphIds])];
      const names = new Set([best.title, ...best.aliases].map(normalizeForSearch));
      for (const a of [c.title, ...c.aliases]) if (!names.has(normalizeForSearch(a))) { best.aliases.push(a); names.add(normalizeForSearch(a)); }
      if (canonical && canonical !== best.title && !best.notes_user_edited && snap.version > 0) {
        if (!best.aliases.includes(best.title)) best.aliases.push(best.title);
        best.title = canonical;
      }
      best.dirty = true;
      dirty.add(best.id);
      // Merges into topics created in this same run don't need an undo entry of their own.
      if (snap.version > 0) {
        merged++;
        log("merge", [], best.id, [snap], [], { title: c.title, aliases: c.aliases, description: c.description, paragraph_ids: c.paragraphIds, source_refs: [], unit_id: unitId });
      }
      onProgress(++done);
      continue;
    }

    let parent: string | null = null;
    if (best && relation === "A_CONTAINS_B" && depthOf(best) < 3) parent = best.id;
    const t = newTopic(teacher.id, c, parent ? best!.unit_id : unitId, parent);
    created++;
    dirty.add(t.id);
    if (best && relation === "B_CONTAINS_A" && !best.parent_topic_id && depthOf(t) < 3) {
      const snap = structuredClone(best);
      best.parent_topic_id = t.id;
      log("subtopic", [best.id], t.id, [snap], [t.id]);
    } else if (best && relation === "A_CONTAINS_B" && parent) {
      log("subtopic", [t.id], best.id, [], [t.id]);
    } else if (best && relation === "RELATED") {
      d.topic_links.push({ topic_a: best.id, topic_b: t.id, kind: "related" });
      log("related", [t.id], best.id, [], [t.id]);
    }
    onProgress(++done);
  }
  return { dirty: [...dirty], merged, created };
}
