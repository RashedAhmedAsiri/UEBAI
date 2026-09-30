import { db } from "@/lib/server/db";
import { fail, json } from "@/lib/server/teachers";
import { createRun, listDatasets, listRuns } from "@/lib/server/bench/runner";
import { ZodError } from "zod";

export const runtime = "nodejs";

/** Proof Lab home: past runs, question sets, and the teachers whose books can be tested. */
export async function GET() {
  const d = db();
  const teachers = d.teachers
    .map((t) => {
      const sources = d.sources.filter((s) => s.teacher_id === t.id && s.status === "ready");
      return {
        id: t.id, name: `${t.title} ${t.name}`, subject: t.subject.name,
        books: sources.map((s) => ({ filename: s.filename, label: s.label, pages: s.pages, tokens: s.token_estimate })),
        topics: d.topics.filter((x) => x.teacher_id === t.id && x.notes_md).length,
      };
    })
    .filter((t) => t.books.length > 0);
  const datasets = listDatasets().map(({ file, dataset }) => ({
    file, name: dataset.name, book_hint: dataset.book_hint ?? null, protocol: dataset.protocol ?? null,
    questions: dataset.questions.map((q) => ({ id: q.id, q: q.q, category: q.category, pages: q.pages })),
  }));
  return json({
    runs: listRuns(), datasets, teachers,
    has_key: Boolean(process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY),
    keys: { gemini: Boolean(process.env.GEMINI_API_KEY), deepseek: Boolean(process.env.DEEPSEEK_API_KEY) },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    return json({ run: createRun(body) }, 201);
  } catch (e) {
    if (e instanceof ZodError) return fail(`Invalid settings: ${e.issues.map((i) => i.path.join(".")).join(", ")}`);
    return fail((e as Error).message);
  }
}
