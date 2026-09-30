import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hashNormalized, repairPdfArabic } from "../text";
import { pruneOrphanTopics } from "../ingest/prune";
import type { DB } from "../types";

/**
 * Local single-user store: one JSON file, loaded once, written back debounced + atomically.
 * Swappable for Postgres later — every access goes through db()/save().
 */
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.ROBOPROF_DATA_DIR || "./data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY: DB = {
  teachers: [], sources: [], units: [], topics: [], topic_links: [], paragraphs: [],
  passages: [], merge_log: [], jobs: [], conversations: [], messages: [],
};

type G = typeof globalThis & { __roboprofDb?: DB; __roboprofSaveTimer?: NodeJS.Timeout | null };
const g = globalThis as G;

export function db(): DB {
  if (!g.__roboprofDb) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Partial<DB>;
      g.__roboprofDb = { ...structuredClone(EMPTY), ...loaded };
      const applied = migrate(g.__roboprofDb);
      if (applied.length) {
        const backup = `${DB_FILE}.before-${applied.join("+")}`;
        if (!fs.existsSync(backup)) fs.copyFileSync(DB_FILE, backup);
        fs.writeFileSync(DB_FILE, JSON.stringify(g.__roboprofDb));
      }
    } else {
      g.__roboprofDb = structuredClone(EMPTY);
    }
  }
  return g.__roboprofDb;
}

export function save(immediate = false) {
  if (g.__roboprofSaveTimer) clearTimeout(g.__roboprofSaveTimer);
  const write = () => {
    g.__roboprofSaveTimer = null;
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db()));
    fs.renameSync(tmp, DB_FILE);
  };
  if (immediate) write();
  else g.__roboprofSaveTimer = setTimeout(write, 250);
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export { pruneOrphanTopics };

/** One-time data upgrades; returns the names of the steps applied (a backup is kept next to db.json). */
function migrate(d: DB): string[] {
  d.meta ??= {};
  const applied: string[] = [];
  if ((d.meta.text_repair ?? 0) < 1) {
    // Books filed before the PDF Arabic repair existed (see repairPdfArabic).
    for (const p of d.paragraphs) {
      const t = repairPdfArabic(p.text);
      if (t !== p.text) { p.text = t; p.norm_hash = hashNormalized(t); }
    }
    for (const p of d.passages) p.text = repairPdfArabic(p.text);
    for (const t of d.topics) { t.notes_md = repairPdfArabic(t.notes_md); t.card_summary = repairPdfArabic(t.card_summary); }
    d.meta.text_repair = 1;
    applied.push("text-repair");
  }
  if ((d.meta.orphan_prune ?? 0) < 1) {
    const removed = pruneOrphanTopics(d);
    if (removed) console.log(`[db] removed ${removed} empty topics left by failed ingestion attempts`);
    d.meta.orphan_prune = 1;
    applied.push("orphan-prune");
  }
  return applied;
}

export function removeWhere<T>(arr: T[], pred: (x: T) => boolean) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
}

/** Delete a teacher and everything that belongs to it. */
export function deleteTeacherCascade(teacherId: string) {
  const d = db();
  const convIds = new Set(d.conversations.filter((c) => c.teacher_id === teacherId).map((c) => c.id));
  for (const s of d.sources.filter((s) => s.teacher_id === teacherId)) {
    try { fs.rmSync(s.storage_path, { force: true }); } catch { /* already gone */ }
  }
  removeWhere(d.messages, (m) => convIds.has(m.conversation_id));
  removeWhere(d.conversations, (c) => c.teacher_id === teacherId);
  const topicIds = new Set(d.topics.filter((t) => t.teacher_id === teacherId).map((t) => t.id));
  removeWhere(d.topic_links, (l) => topicIds.has(l.topic_a) || topicIds.has(l.topic_b));
  for (const key of ["sources", "units", "topics", "paragraphs", "passages", "merge_log"] as const) {
    removeWhere(d[key] as { teacher_id: string }[], (x) => x.teacher_id === teacherId);
  }
  removeWhere(d.jobs, (j) => j.payload.teacher_id === teacherId);
  removeWhere(d.teachers, (t) => t.id === teacherId);
  save();
}
