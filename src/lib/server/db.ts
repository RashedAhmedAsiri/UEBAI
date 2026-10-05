import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { after } from "next/server";
import { hashNormalized, repairPdfArabic } from "../text";
import { pruneOrphanTopics } from "../ingest/prune";
import { hosted, kv } from "./kv";
import { DB_CHUNK, DB_HEAD_KEY, dbChunkKey, type DbHead } from "../storage-format";
import { DATA_DIR, UPLOAD_DIR, removeStoredFile } from "./files";
import type { DB } from "../types";

/**
 * Single-user store: one JSON object, loaded once, written back debounced.
 * Locally it is ./data/db.json (atomic rename). When hosted (Vercel) the filesystem is temporary,
 * so it is kept gzipped in Redis instead; every API route calls syncDb() first, which loads it
 * (or picks up a newer copy written by another server instance) and flushes changes after the
 * response. Every access goes through db()/save().
 */
export { DATA_DIR, UPLOAD_DIR };
const NO_STORAGE = "This site has no database yet. In Vercel open the project → Storage → connect an Upstash Redis database, then redeploy.";
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY: DB = {
  teachers: [], sources: [], units: [], topics: [], topic_links: [], paragraphs: [],
  passages: [], merge_log: [], jobs: [], conversations: [], messages: [],
};

type Head = DbHead;
type G = typeof globalThis & {
  __roboprofDb?: DB; __roboprofSaveTimer?: NodeJS.Timeout | null;
  __uebaiHead?: Head | null; __uebaiDirty?: boolean; __uebaiHolds?: number;
  __uebaiLoading?: Promise<void> | null; __uebaiFlushing?: Promise<void>;
};
const g = globalThis as G;

export function db(): DB {
  if (!g.__roboprofDb) {
    if (hosted()) throw new Error("Database not loaded yet (the route must call syncDb() first).");
    if (process.env.VERCEL) throw new Error(NO_STORAGE);
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
  if (hosted()) {
    g.__uebaiDirty = true;
    const flush = () => { g.__roboprofSaveTimer = null; flushDb().catch((err) => console.error("[db] save failed:", err)); };
    if (immediate) flush();
    else g.__roboprofSaveTimer = setTimeout(flush, 1000);
    return;
  }
  const write = () => {
    g.__roboprofSaveTimer = null;
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db()));
    fs.renameSync(tmp, DB_FILE);
  };
  if (immediate) write();
  else g.__roboprofSaveTimer = setTimeout(write, 250);
}

// ---------- Hosted mode (Redis) ----------

const HEAD_KEY = DB_HEAD_KEY, CHUNK = DB_CHUNK, chunkKey = dbChunkKey;

/**
 * Call at the start of every API route. Locally a no-op. Hosted: loads the database (or a newer
 * copy another instance saved) and makes sure changes are written back after the response.
 */
export async function syncDb(): Promise<void> {
  if (!hosted()) { db(); return; }
  try { after(() => flushDb()); } catch { /* not inside a request */ }
  // A background job on this instance holds references into the current copy, and unsaved edits
  // would be lost: keep the in-memory copy then (it is written back on the next flush).
  if (g.__roboprofDb && (g.__uebaiDirty || (g.__uebaiHolds ?? 0) > 0)) return;
  g.__uebaiLoading ??= load().finally(() => { g.__uebaiLoading = null; });
  await g.__uebaiLoading;
}

async function load(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const raw = await kv<string | null>("GET", HEAD_KEY);
    const head = raw ? (JSON.parse(raw) as Head) : null;
    if (g.__roboprofDb && head?.ver === g.__uebaiHead?.ver) return;
    if (!head) {
      g.__roboprofDb ??= structuredClone(EMPTY);
      return;
    }
    const parts = await Promise.all(Array.from({ length: head.n }, (_, i) => kv<string | null>("GET", chunkKey(head, i))));
    if (parts.some((p) => p == null)) {
      if (attempt >= 3) throw new Error("Could not read the database from storage.");
      continue; // replaced while we were reading: read the new head
    }
    const loaded = JSON.parse(zlib.gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8")) as Partial<DB>;
    if (g.__roboprofDb && (g.__uebaiDirty || (g.__uebaiHolds ?? 0) > 0)) return; // changed while loading
    g.__roboprofDb = { ...structuredClone(EMPTY), ...loaded };
    g.__uebaiHead = head;
    if (migrate(g.__roboprofDb).length) g.__uebaiDirty = true;
    return;
  }
}

/** Write unsaved changes now (hosted: to Redis; locally: to db.json). Safe to call any time. */
export function flushDb(): Promise<void> {
  if (!hosted()) {
    if (g.__roboprofSaveTimer) { clearTimeout(g.__roboprofSaveTimer); save(true); }
    return Promise.resolve();
  }
  g.__uebaiFlushing = (g.__uebaiFlushing ?? Promise.resolve()).catch(() => {}).then(writeRemote);
  return g.__uebaiFlushing;
}

async function writeRemote() {
  if (!g.__uebaiDirty || !g.__roboprofDb) return;
  if (g.__roboprofSaveTimer) { clearTimeout(g.__roboprofSaveTimer); g.__roboprofSaveTimer = null; }
  g.__uebaiDirty = false;
  const payload = zlib.gzipSync(JSON.stringify(g.__roboprofDb)).toString("base64");
  const head: Head = { ver: crypto.randomUUID(), n: Math.max(1, Math.ceil(payload.length / CHUNK)) };
  let previous: string | null;
  try {
    await Promise.all(Array.from({ length: head.n }, (_, i) => kv("SET", chunkKey(head, i), payload.slice(i * CHUNK, (i + 1) * CHUNK))));
    previous = await kv<string | null>("SET", HEAD_KEY, JSON.stringify(head), "GET");
  } catch (err) {
    g.__uebaiDirty = true;
    throw err;
  }
  g.__uebaiHead = head;
  if (previous) {
    const old = JSON.parse(previous) as Head;
    await Promise.all(Array.from({ length: old.n }, (_, i) => kv("DEL", chunkKey(old, i)))).catch(() => {});
  }
}

/** While held, syncDb() keeps this instance's copy (a background job is working on it). */
export function holdDb(): () => void {
  g.__uebaiHolds = (g.__uebaiHolds ?? 0) + 1;
  let released = false;
  return () => { if (!released) { released = true; g.__uebaiHolds = Math.max(0, (g.__uebaiHolds ?? 1) - 1); } };
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
  for (const s of d.sources.filter((s) => s.teacher_id === teacherId)) void removeStoredFile(s.storage_path);
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
