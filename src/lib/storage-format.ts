/**
 * How the hosted site lays out its data in Redis. Shared by the server (src/lib/server/db.ts,
 * files.ts) and eval/push_online.ts, which copies a local library to the hosted site.
 */
export const DB_HEAD_KEY = "uebai:db:head";
/** base64 characters per Redis value (requests stay well under Upstash's size limit) */
export const DB_CHUNK = 3_000_000;
export interface DbHead { ver: string; n: number }
export const dbChunkKey = (h: DbHead, i: number) => `uebai:db:${h.ver}:${i}`;

/** Uploaded files are stored in parts of at most this many bytes. */
export const PART_BYTES = 3 * 1024 * 1024;
export const partKey = (uploadId: string, n: number) => `uebai:up:${uploadId}:${n}`;
/** A source's storage_path when its file lives in Redis. */
export const kvStoragePath = (uploadId: string, parts: number, ext: string) => `kv:${uploadId}:${parts}:${ext}`;
