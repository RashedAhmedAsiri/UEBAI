/**
 * Add a book to a teacher and file it into topic cards without the website (same steps as the
 * upload + confirm buttons, then the normal ingestion job). Stop the site first: two programs
 * writing data/db.json at once would overwrite each other.
 *
 *   npx tsx --conditions=react-server eval/add_book.ts --teacher <id> --file "C:\path\book.pdf" [--label "التاريخ"]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, save, uid, UPLOAD_DIR } from "../src/lib/server/db";
import { extract, mimeFor } from "../src/lib/server/ingest/extract";
import { enqueue } from "../src/lib/server/jobs";
import { estimateTokens } from "../src/lib/text";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[++i]);

async function main() {
  const d = db();
  const teacher = d.teachers.find((t) => t.id === args.get("teacher"));
  if (!teacher) throw new Error("Teacher not found");
  const file = args.get("file");
  if (!file || !fs.existsSync(file)) throw new Error("File not found");
  const buf = fs.readFileSync(file);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  let source = d.sources.find((s) => s.teacher_id === teacher.id && s.sha256 === sha256);
  if (source?.status === "ready") { console.log("Already filed:", source.label); return; }

  if (!source) {
    const id = uid();
    const ext = path.extname(file).toLowerCase();
    const storage_path = path.join(UPLOAD_DIR, `${id}${ext}`);
    fs.copyFileSync(file, storage_path);
    const mime = mimeFor(file);
    const ex = await extract(storage_path, mime, { allowOcr: false });
    source = {
      id, teacher_id: teacher.id, filename: path.basename(file), label: args.get("label") ?? path.basename(file, ext).slice(0, 32),
      mime, sha256, pages: ex.pageCount, status: "awaiting_confirm", storage_path,
      token_estimate: ex.pages.reduce((n, p) => n + estimateTokens(p.text), 0), cost_estimate_usd: 0, job_id: null, error: null, created_at: now(),
    };
    d.sources.push(source);
    console.log(`Added ${source.filename}: ${source.pages} pages, ~${source.token_estimate} tokens`);
  }
  source.status = "queued";
  source.error = null;
  const job = enqueue("ingest", { teacher_id: teacher.id, source_id: source.id });
  source.job_id = job.id;
  save(true);

  let last = "";
  for (;;) {
    const j = db().jobs.find((x) => x.id === job.id)!;
    const line = `${j.status} ${j.progress.pct}% ${j.progress.message}`;
    if (line !== last) { console.log(new Date().toLocaleTimeString("en-GB"), line); last = line; }
    if (j.status === "done" || j.status === "failed") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  save(true);
  const topics = db().topics.filter((t) => t.teacher_id === teacher.id && t.notes_md).length;
  console.log(`Topic cards with notes: ${topics}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
