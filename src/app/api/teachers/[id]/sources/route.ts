import path from "node:path";
import crypto from "node:crypto";
import { db, now, save, syncDb, uid } from "@/lib/server/db";
import { discardUpload, keepUpload, materialize, readUpload, removeStoredFile, validUpload } from "@/lib/server/files";
import { fail, getTeacher, json } from "@/lib/server/teachers";
import { extract, mimeFor, SUPPORTED_EXT } from "@/lib/server/ingest/extract";
import { estimateTokens } from "@/lib/text";
import { MODELS, price } from "@/lib/ai/models";
import { isLive } from "@/lib/ai/provider";
import { requestHasSession } from "@/lib/auth";

export const maxDuration = 300;

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
const MAX_BYTES = 500 * 1024 * 1024;

export async function GET(req: Request, { params }: Ctx) {
  if (!requestHasSession(req)) return fail("Please sign in", 401);
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const d = db();
  const sources = d.sources.filter((s) => s.teacher_id === t.id).map((s) => ({ ...s, job: d.jobs.find((j) => j.id === s.job_id) ?? null }));
  return json({ sources });
}

function labelFrom(filename: string) {
  return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 32) || "Source";
}

/** Estimate ingestion cost: digest model reads everything once; notes model reads it again and writes notes. */
function estimateCost(tokens: number) {
  const [dIn, dOut] = price(MODELS.digest), [nIn, nOut] = price(MODELS.notes);
  const topics = Math.max(1, Math.round(tokens / 2500));
  const digest = (tokens * 1.2 * dIn + tokens * 0.1 * dOut + topics * 800 * dIn + topics * 300 * dOut) / 1e6;
  const notes = (tokens * 1.1 * nIn + topics * 1500 * nOut) / 1e6;
  return Math.round((digest + notes) * 1000) / 1000;
}

/** Upload → fingerprint → estimate. Processing starts only after the user confirms. */
/**
 * Two ways in: a multipart form with `file`, or JSON { upload_id, parts, filename } naming a file
 * the browser already sent in parts to /api/uploads (needed when hosted: request bodies are capped).
 */
export async function POST(req: Request, { params }: Ctx) {
  // Not covered by proxy (it would buffer 500 MB uploads in memory), so check the session here.
  if (!requestHasSession(req)) return fail("Please sign in", 401);
  await syncDb();
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);

  let name: string, buf: Buffer, upload: { id: string; parts: number } | null = null;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { upload_id?: string; parts?: number; filename?: string };
    if (!body.upload_id || !body.parts || !body.filename || !validUpload(body.upload_id, body.parts)) return fail("No file uploaded");
    upload = { id: body.upload_id, parts: body.parts };
    name = body.filename;
    try { buf = await readUpload(upload.id, upload.parts); } catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
  } else {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return fail("No file uploaded");
    if (file.size > MAX_BYTES) return fail("File is larger than 500 MB");
    name = file.name;
    buf = Buffer.from(await file.arrayBuffer());
  }
  const drop = () => upload ? discardUpload(upload.id, upload.parts) : Promise.resolve();
  const file = { name, size: buf.length };
  if (file.size > MAX_BYTES) { await drop(); return fail("File is larger than 500 MB"); }
  const ext = path.extname(file.name).toLowerCase();
  if (!SUPPORTED_EXT.includes(ext)) { await drop(); return fail(`Unsupported file type ${ext}. Try PDF, DOCX, PPTX, EPUB, TXT, MD or an image.`); }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const d = db();
  const dup = d.sources.find((s) => s.teacher_id === t.id && s.sha256 === sha256 && s.status !== "failed");
  if (dup) { await drop(); return json({ duplicate: true, source: dup, message: `"${file.name}" is already in ${t.name}'s library — skipped.` }); }

  const id = uid();
  const storage_path = await keepUpload(upload, id, ext, buf);
  const mime = mimeFor(file.name);

  let pages = 1, tokens = 0, scanned = false;
  try {
    const ex = await extract(await materialize(storage_path), mime, { allowOcr: false });
    pages = ex.pageCount;
    tokens = ex.pages.reduce((n, p) => n + estimateTokens(p.text), 0);
    if (tokens < pages * 10) { scanned = true; tokens = pages * 600; }
  } catch (err) {
    await removeStoredFile(storage_path);
    return fail(`Could not read this file: ${err instanceof Error ? err.message : String(err)}`);
  }

  let label = labelFrom(file.name);
  const taken = new Set(d.sources.filter((s) => s.teacher_id === t.id).map((s) => s.label.toLowerCase()));
  for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${labelFrom(file.name).slice(0, 28)} ${n}`;
  const source = {
    id, teacher_id: t.id, filename: file.name, label, mime, sha256, pages,
    status: "awaiting_confirm" as const, storage_path, token_estimate: tokens,
    cost_estimate_usd: isLive() ? estimateCost(tokens) : 0, job_id: null, error: null, created_at: now(),
  };
  d.sources.push(source);
  save();
  return json({
    source,
    estimate: {
      pages, tokens, scanned, live: isLive(),
      usd: source.cost_estimate_usd,
      minutes: Math.max(1, Math.round((isLive() ? pages * 0.5 : pages * 0.02) / 60 * 10) / 10),
    },
  }, 201);
}
