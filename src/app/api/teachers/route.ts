import { db } from "@/lib/server/db";
import { createTeacher, json, teacherSummary } from "@/lib/server/teachers";
import { TEMPLATES } from "@/lib/templates";

export async function GET() {
  const teachers = [...db().teachers].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(teacherSummary);
  return json({ teachers });
}

/** Body: { lang?: "ar" | "en", template?: TemplateId } — new teachers speak the visitor's language (Arabic by default). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { lang?: string; template?: string };
  const template = TEMPLATES.find((t) => t === body.template);
  return json({ teacher: createTeacher(body.lang === "en" ? "en" : "ar", template) }, 201);
}
