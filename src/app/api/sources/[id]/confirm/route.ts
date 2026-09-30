import { db, save } from "@/lib/server/db";
import { enqueue } from "@/lib/server/jobs";
import { fail, json } from "@/lib/server/teachers";

type Ctx = { params: Promise<{ id: string }> };

/** User confirmed the cost estimate → enqueue ingestion. Optional body: { label }. */
export async function POST(req: Request, { params }: Ctx) {
  const d = db();
  const { id } = await params;
  const source = d.sources.find((s) => s.id === id);
  if (!source) return fail("Source not found", 404);
  if (source.status !== "awaiting_confirm" && source.status !== "failed") return fail("Already processing");
  const body = (await req.json().catch(() => ({}))) as { label?: string };
  if (body.label?.trim()) {
    const label = body.label.trim().slice(0, 32);
    if (d.sources.some((s) => s.teacher_id === source.teacher_id && s.id !== source.id && s.label.toLowerCase() === label.toLowerCase())) {
      return fail("Another source already uses that short name — pick a different one.");
    }
    source.label = label;
  }
  const teacher = d.teachers.find((t) => t.id === source.teacher_id);
  // Default knowledge mode flips to "files first" once there are files.
  if (teacher && teacher.knowledge_mode === "internet" && !d.sources.some((s) => s.teacher_id === teacher.id && s.status === "ready")) {
    teacher.knowledge_mode = "files_first";
  }
  source.status = "queued";
  source.error = null;
  const job = enqueue("ingest", { teacher_id: source.teacher_id, source_id: source.id });
  source.job_id = job.id;
  save();
  return json({ source, job });
}
