/**
 * Copy this computer's library (teachers, filed books, topic cards, chats and the book files) to
 * the hosted site's Redis database, so the online site starts with everything already filed.
 *
 * 1. In Vercel: project → Storage → your Upstash database → ".env.local" tab → copy the lines.
 * 2. Paste them into a file named .env.online next to package.json (it is git-ignored).
 * 3. npm run push-online            (add -- --replace if the online site already has data)
 *
 * The online copy is replaced as a whole; nothing on this computer is changed.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { DB_CHUNK, DB_HEAD_KEY, dbChunkKey, kvStoragePath, PART_BYTES, partKey, type DbHead } from "../src/lib/storage-format";
import type { DB } from "../src/lib/types";

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const env = { ...readEnvFile(".env.online"), ...process.env };
const URL_ = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const TOKEN = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
const DATA_DIR = path.resolve(env.ROBOPROF_DATA_DIR || "./data");
const replace = process.argv.includes("--replace");

async function kv<T = unknown>(...cmd: (string | number)[]): Promise<T> {
  const res = await fetch(URL_!.replace(/\/$/, ""), { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(`Storage error ${res.status}: ${data.error ?? res.statusText}`);
  return data.result as T;
}

async function main() {
  if (!URL_ || !TOKEN) throw new Error("Put KV_REST_API_URL and KV_REST_API_TOKEN in .env.online first (Vercel → Storage → your database → .env.local tab).");
  const dbFile = path.join(DATA_DIR, "db.json");
  if (!fs.existsSync(dbFile)) throw new Error(`No library found at ${dbFile}`);
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8")) as DB;

  const existing = await kv<string | null>("GET", DB_HEAD_KEY);
  if (existing && !replace) throw new Error("The online site already has data. Run again with --replace to overwrite it (npm run push-online -- --replace).");

  // Book files: upload each in parts and point the online copy at them.
  for (const s of db.sources) {
    // (the project folder may have moved since the book was uploaded: look in uploads/ too)
    const moved = s.storage_path ? path.join(DATA_DIR, "uploads", path.basename(s.storage_path)) : "";
    if (s.storage_path && !fs.existsSync(s.storage_path) && fs.existsSync(moved)) s.storage_path = moved;
    if (!s.storage_path || s.storage_path.startsWith("kv:") || !fs.existsSync(s.storage_path)) {
      console.log(`  (no file on this computer for ${s.filename} — its topic cards still go up)`);
      continue;
    }
    const buf = fs.readFileSync(s.storage_path);
    const id = crypto.randomUUID(), parts = Math.max(1, Math.ceil(buf.length / PART_BYTES));
    for (let n = 0; n < parts; n++) await kv("SET", partKey(id, n), buf.subarray(n * PART_BYTES, (n + 1) * PART_BYTES).toString("base64"));
    s.storage_path = kvStoragePath(id, parts, path.extname(s.storage_path).toLowerCase());
    console.log(`  uploaded ${s.filename} (${(buf.length / 1048576).toFixed(1)} MB)`);
  }
  // Jobs that were mid-way on this computer would restart online; finished ones are kept as history.
  for (const j of db.jobs) if (j.status === "running") j.status = "queued";

  const payload = zlib.gzipSync(JSON.stringify(db)).toString("base64");
  const head: DbHead = { ver: crypto.randomUUID(), n: Math.max(1, Math.ceil(payload.length / DB_CHUNK)) };
  for (let i = 0; i < head.n; i++) await kv("SET", dbChunkKey(head, i), payload.slice(i * DB_CHUNK, (i + 1) * DB_CHUNK));
  const previous = await kv<string | null>("SET", DB_HEAD_KEY, JSON.stringify(head), "GET");
  if (previous) {
    const old = JSON.parse(previous) as DbHead;
    for (let i = 0; i < old.n; i++) await kv("DEL", dbChunkKey(old, i));
  }
  const count = (k: keyof DB) => (db[k] as unknown[]).length;
  console.log(`Done: ${count("teachers")} teachers, ${count("sources")} books, ${count("topics")} topics, ${count("conversations")} chats are now on the online site.`);
  console.log("Reload the site to see them.");
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
