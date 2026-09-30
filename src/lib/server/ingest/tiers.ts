import "server-only";
import { db, now, removeWhere, save, uid } from "../db";
import { completeJson, complete, isLive } from "../../ai/provider";
import { studyNotesPrompt, indexCardPrompt } from "../../ai/prompts";
import { LEVEL_TEXT } from "../../ai/personality";
import { chunkPassages } from "../../ingest/structure";
import { relabelRefs } from "../../ingest/merge";
import { estimateTokens, sentences, tokenize } from "../../text";
import type { Paragraph, Source, Teacher, Topic } from "../../types";

const NOTES_BUDGET = 2000;
const MAX_NOTES_INPUT = 40_000;

export async function pMap<T, R>(items: T[], concurrency: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export function topicParagraphs(topic: Topic): Paragraph[] {
  const ids = new Set(topic.paragraph_ids);
  return db().paragraphs.filter((p) => ids.has(p.id)).sort((a, b) => a.source_id.localeCompare(b.source_id) || a.idx - b.idx);
}

/** Recompute source page ranges from the topic's paragraphs. */
export function refreshSourceRefs(topic: Topic) {
  const byS = new Map<string, { a: number; b: number }>();
  for (const p of topicParagraphs(topic)) {
    const r = byS.get(p.source_id);
    if (!r) byS.set(p.source_id, { a: p.page, b: p.page });
    else { r.a = Math.min(r.a, p.page); r.b = Math.max(r.b, p.page); }
  }
  topic.source_refs = [...byS].map(([source_id, r]) => ({ source_id, page_start: r.a, page_end: r.b }));
}

/** Tier 3: rechunk passages for a topic from all its paragraphs across all sources. */
export function buildPassages(topic: Topic) {
  const d = db();
  removeWhere(d.passages, (p) => p.topic_id === topic.id);
  const bySource = new Map<string, Paragraph[]>();
  for (const p of topicParagraphs(topic)) {
    if (!bySource.has(p.source_id)) bySource.set(p.source_id, []);
    bySource.get(p.source_id)!.push(p);
  }
  for (const [source_id, paras] of bySource) {
    for (const c of chunkPassages(paras)) {
      d.passages.push({ id: uid(), teacher_id: topic.teacher_id, topic_id: topic.id, source_id, ...c });
    }
  }
}

function labelledPassages(topic: Topic, sources: Map<string, Source>) {
  const passages = db().passages.filter((p) => p.topic_id === topic.id);
  const order = [...new Set(passages.map((p) => p.source_id))];
  const labels = order.map((id) => sources.get(id)?.label ?? "Source");
  const text = passages.map((p) => {
    const b = order.indexOf(p.source_id) + 1;
    const pages = p.page_start === p.page_end ? `p.${p.page_start}` : `p.${p.page_start}-${p.page_end}`;
    return `[B${b} ${pages}] (${labels[b - 1]})\n${p.text}`;
  });
  return { chunks: text, labels, nSources: order.length };
}

/** Build notes with the LLM; handles oversize input by summarizing in parts first. */
async function llmNotes(topic: Topic, teacher: Teacher, sources: Map<string, Source>): Promise<string> {
  const { chunks, labels, nSources } = labelledPassages(topic, sources);
  const level = LEVEL_TEXT[teacher.subject.level ?? teacher.personality.level];
  const ar = notesInArabic(teacher);
  // Notes are for the student, so they are written in the student's language even when the book is not.
  const language = ar ? "Arabic (including all section headings; keep technical terms' English name in parentheses when the source is English)" : "English";
  const groups: string[][] = [[]];
  let size = 0;
  for (const c of chunks) {
    const t = estimateTokens(c);
    if (size + t > MAX_NOTES_INPUT && groups[groups.length - 1].length) { groups.push([]); size = 0; }
    groups[groups.length - 1].push(c); size += t;
  }
  let input = groups[0].join("\n\n");
  if (groups.length > 1) {
    // Too big for one call: condense each part (keeping refs), then merge.
    const partials = await pMap(groups, 3, async (g) =>
      (await complete({ role: "notes", maxTokens: 6000, messages: [{ role: "user", content: studyNotesPrompt(topic.title, level, language, 3000, nSources, g.join("\n\n")) }] })).text);
    input = partials.join("\n\n---\n\n");
  }
  let { text } = await complete({ role: "notes", maxTokens: 6000, messages: [{ role: "user", content: studyNotesPrompt(topic.title, level, language, NOTES_BUDGET, nSources, input) }] });
  const split = text.match(/"split_suggestion"\s*:\s*(\[[^\]]*\])/);
  if (split) {
    const suggestion = JSON.parse(split[1]) as string[];
    ({ text } = await complete({
      role: "notes", maxTokens: 6000,
      messages: [{ role: "user", content: studyNotesPrompt(topic.title, level, language, NOTES_BUDGET, nSources, input).replace(/- If the content cannot fit[^\n]*\n/, "- Prioritise the most important content; it must fit.\n") }],
    }));
    text += ar
      ? `\n\n> ✂ هذا الموضوع كبير. تقسيم مقترح: ${suggestion.join(" · ")} (استخدم «تقسيم» في المكتبة).`
      : `\n\n> ✂ This topic is large. Suggested split: ${suggestion.join(" · ")} (use Split in the Library).`;
  }
  const notes = relabelRefs(text.trim(), labels);
  return ar ? arabicRefs(notes) : notes;
}

/** Notes are written in the student's language (the teacher's primary language). */
export const notesInArabic = (teacher: Teacher) => teacher.personality.language.primary === "ar";

/** In Arabic notes, page refs read "ص." instead of "p.". */
export function arabicRefs(notes: string): string {
  return notes.replace(/\[([^\]]*?\bp\.[^\]]*)\]/g, (_, inner: string) => "[" + inner.replace(/\bp\.\s?(\d)/g, "ص.$1") + "]");
}

/** Offline extractive notes for demo mode. */
function extractiveNotes(topic: Topic, sources: Map<string, Source>, ar: boolean): string {
  const paras = topicParagraphs(topic);
  const ref = (p: Paragraph) => `[${sources.get(p.source_id)?.label ?? (ar ? "المصدر" : "Source")} ${ar ? "ص." : "p."}${p.page}]`;
  const allText = paras.map((p) => p.text).join(" ");
  const summary = sentences(allText).slice(0, 2).join(" ");
  // Count real words (not stems) so key terms read naturally.
  const freq = new Map<string, number>();
  // Keep the original spelling (ة, أ…), only drop diacritics/tatweel and punctuation.
  const words = allText.toLowerCase().replace(/[ً-ٰٟـ]/g, "").split(/[^\p{L}\p{N}]+/u);
  for (const w of words) if (w.length > 3 && tokenize(w).length) freq.set(w, (freq.get(w) ?? 0) + 1);
  const terms = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  const core: string[] = [];
  let tokens = 0;
  const seen = new Set<string>();
  for (const p of paras) {
    const s = sentences(p.text)[0];
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const line = `- ${s} ${ref(p)}`;
    tokens += estimateTokens(line);
    if (tokens > NOTES_BUDGET - 300) break;
    core.push(line);
  }
  return [
    ar ? "### الملخص" : "### Summary", summary || topic.title, "",
    ar ? "### المصطلحات الأساسية" : "### Key terms", terms.map((t) => `**${t}**`).join(" · "), "",
    ar ? "### الملاحظات الأساسية" : "### Core notes", ...core, "",
    ar ? "_الوضع التجريبي: ملاحظات مقتبسة من النص. أضِف مفتاح الذكاء الاصطناعي لملاحظات يكتبها المعلّم._" : "_Demo mode: extractive notes. Add an API key for AI-written study notes._",
  ].join("\n");
}

/** Build Tier 3 → Tier 2 → Tier 1 for the given (dirty) topics. */
export async function buildTiers(topicIds: string[], onProgress: (done: number, total: number, title: string) => void) {
  const d = db();
  const sources = new Map(d.sources.map((s) => [s.id, s]));
  const topics = topicIds.map((id) => d.topics.find((t) => t.id === id)).filter((t): t is Topic => !!t);
  let done = 0;
  await pMap(topics, isLive() ? 4 : 8, async (topic) => {
    const teacher = d.teachers.find((t) => t.id === topic.teacher_id)!;
    refreshSourceRefs(topic);
    buildPassages(topic);
    if (!topic.notes_user_edited || !topic.notes_md) {
      topic.notes_md = isLive() ? await llmNotes(topic, teacher, sources) : extractiveNotes(topic, sources, notesInArabic(teacher));
      topic.notes_tokens = estimateTokens(topic.notes_md);
    }
    await buildCard(topic, teacher);
    topic.dirty = false;
    topic.version++;
    topic.updated_at = now();
    save();
    onProgress(++done, topics.length, topic.title);
  });
}

async function buildCard(topic: Topic, teacher: Teacher) {
  if (isLive()) {
    const other = teacher.personality.language.secondary && teacher.personality.language.secondary !== teacher.personality.language.primary
      ? (teacher.personality.language.secondary === "ar" ? "Arabic" : "English") : null;
    const { data } = await completeJson<{ aliases?: string[]; keywords?: string[]; summary?: string }>({
      role: "digest", maxTokens: 1000, messages: [{ role: "user", content: indexCardPrompt(topic.notes_md, other) }],
    });
    topic.aliases = [...new Set([...topic.aliases, ...(data.aliases ?? [])])].filter((a) => a !== topic.title).slice(0, 10);
    topic.keywords = (data.keywords ?? []).slice(0, 12);
    topic.card_summary = data.summary ?? topic.card_summary;
  } else {
    const summary = (topic.notes_md.split("### Summary")[1] ?? topic.notes_md.split("### الملخص")[1])?.split("###")[0]?.trim() ?? "";
    topic.card_summary = sentences(summary).slice(0, 2).join(" ") || topic.title;
    const kw = topic.notes_md.match(/\*\*([^*]+)\*\*/g)?.map((m) => m.replace(/\*/g, "")) ?? [];
    topic.keywords = kw.slice(0, 10);
  }
}
