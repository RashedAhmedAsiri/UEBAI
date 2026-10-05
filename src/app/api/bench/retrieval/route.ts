import { fail, json } from "@/lib/server/teachers";
import { retrievalCheck, retrievalFile, saveRetrieval, savedRetrievals } from "@/lib/server/bench/retrieval";
import { syncDb } from "@/lib/server/db";
import { BENCH_LOCAL_ONLY, hosted } from "@/lib/server/kv";

export const maxDuration = 300;

export const runtime = "nodejs";

/** Saved free retrieval checks (one per question set). */
export async function GET() {
  await syncDb();
  return json({ reports: savedRetrievals() });
}

/**
 * Run the free retrieval check. Body: { teacher_id, dataset, window?, exact? }
 * exact adds Google's official token counts (free countTokens; needs GEMINI_API_KEY).
 */
export async function POST(req: Request) {
  await syncDb();
  if (hosted()) return fail(BENCH_LOCAL_ONLY);
  const body = (await req.json().catch(() => ({}))) as { teacher_id?: string; dataset?: string; window?: number; exact?: boolean; all_sources?: boolean };
  const dataset = body.dataset ?? "";
  if (!body.teacher_id || !/^[\w.-]+\.json$/.test(dataset)) return fail("Choose a book and a question set");
  const window = Math.max(1000, Math.min(2_000_000, Number(body.window) || 8192));
  const exact = body.exact && process.env.GEMINI_API_KEY ? "gemini-3.6-flash" : null;
  try {
    const report = await retrievalCheck(body.teacher_id, dataset, window, exact, Boolean(body.all_sources));
    saveRetrieval(dataset, report);
    return json({ report: { ...report, file: retrievalFile(dataset, report.scope) } });
  } catch (e) {
    return fail((e as Error).message);
  }
}
