import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "next/server";
import { hosted, kv } from "./kv";
import { kvStoragePath, PART_BYTES, partKey } from "../storage-format";

/**
 * Uploaded files. The browser sends a file in parts of at most PART_BYTES (hosting platforms cap
 * request bodies at a few MB), then asks the sources route to assemble them.
 * Locally the file ends up in ./data/uploads like before. Hosted, the parts stay in Redis and the
 * source's storage_path is "kv:<upload id>:<parts>:<ext>"; materialize() copies it to the
 * temporary disk when a step needs a real file.
 */
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.ROBOPROF_DATA_DIR || "./data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PARTS_DIR = path.join(UPLOAD_DIR, ".parts");
const TMP_DIR = path.join(os.tmpdir(), "uebai-files");

export { PART_BYTES };
export const MAX_PARTS = 200;
const UPLOAD_ID = /^[0-9a-f-]{36}$/;

export function validUpload(uploadId: string, parts: number): boolean {
  return UPLOAD_ID.test(uploadId) && Number.isInteger(parts) && parts >= 1 && parts <= MAX_PARTS;
}

const partFile = (uploadId: string, n: number) => path.join(PARTS_DIR, `${uploadId}.${n}`);

export async function putUploadPart(uploadId: string, n: number, buf: Buffer) {
  if (hosted()) {
    await kv("SET", partKey(uploadId, n), buf.toString("base64"), "EX", 86_400);
  } else {
    fs.mkdirSync(PARTS_DIR, { recursive: true });
    fs.writeFileSync(partFile(uploadId, n), buf);
  }
}

export async function readUpload(uploadId: string, parts: number): Promise<Buffer> {
  const bufs: Buffer[] = [];
  for (let n = 0; n < parts; n++) {
    if (hosted()) {
      const b64 = await kv<string | null>("GET", partKey(uploadId, n));
      if (b64 == null) throw new Error("Part of the upload is missing — please upload the file again.");
      bufs.push(Buffer.from(b64, "base64"));
    } else {
      if (!fs.existsSync(partFile(uploadId, n))) throw new Error("Part of the upload is missing — please upload the file again.");
      bufs.push(fs.readFileSync(partFile(uploadId, n)));
    }
  }
  return Buffer.concat(bufs);
}

/**
 * Keep an assembled file as a source's file; returns its storage_path. `upload` names the parts
 * it came from (null when it arrived in one piece).
 */
export async function keepUpload(upload: { id: string; parts: number } | null, sourceId: string, ext: string, buf: Buffer): Promise<string> {
  if (hosted()) {
    let uploadId: string, parts: number;
    if (upload) {
      ({ id: uploadId, parts } = upload);
      await Promise.all(Array.from({ length: parts }, (_, n) => kv("PERSIST", partKey(uploadId, n))));
    } else {
      uploadId = crypto.randomUUID();
      parts = Math.max(1, Math.ceil(buf.length / PART_BYTES));
      for (let n = 0; n < parts; n++) await kv("SET", partKey(uploadId, n), buf.subarray(n * PART_BYTES, (n + 1) * PART_BYTES).toString("base64"));
    }
    const storagePath = kvStoragePath(uploadId, parts, ext);
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(tmpPath(storagePath), buf);
    return storagePath;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const storagePath = path.join(UPLOAD_DIR, `${sourceId}${ext}`);
  fs.writeFileSync(storagePath, buf);
  if (upload) await discardUpload(upload.id, upload.parts);
  return storagePath;
}

/** Drop the parts of an upload that will not be kept. */
export async function discardUpload(uploadId: string, parts: number) {
  if (hosted()) await Promise.all(Array.from({ length: parts }, (_, n) => kv("DEL", partKey(uploadId, n)))).catch(() => {});
  else for (let n = 0; n < parts; n++) fs.rmSync(partFile(uploadId, n), { force: true });
}

function parseKv(storagePath: string) {
  const [, uploadId, parts, ext] = storagePath.split(":");
  return { uploadId, parts: Number(parts), ext };
}
const tmpPath = (storagePath: string) => {
  const { uploadId, ext } = parseKv(storagePath);
  return path.join(TMP_DIR, `${uploadId}${ext}`);
};

/** A local path to read the file from (hosted: fetched from Redis into the temporary disk once). */
export async function materialize(storagePath: string): Promise<string> {
  if (!storagePath.startsWith("kv:")) return storagePath;
  const file = tmpPath(storagePath);
  if (!fs.existsSync(file)) {
    const { uploadId, parts } = parseKv(storagePath);
    const buf = await readUpload(uploadId, parts);
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(file + ".tmp", buf);
    fs.renameSync(file + ".tmp", file);
  }
  return file;
}

export function removeStoredFile(storagePath: string): Promise<void> {
  if (!storagePath.startsWith("kv:")) {
    try { fs.rmSync(storagePath, { force: true }); } catch { /* already gone */ }
    return Promise.resolve();
  }
  try { fs.rmSync(tmpPath(storagePath), { force: true }); } catch { /* not cached here */ }
  const { uploadId, parts } = parseKv(storagePath);
  const done = discardUpload(uploadId, parts);
  try { after(() => done); } catch { /* not inside a request */ }
  return done;
}
