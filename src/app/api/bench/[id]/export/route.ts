import { fail } from "@/lib/server/teachers";
import { getRun, toCsv } from "@/lib/server/bench/runner";
import { syncDb } from "@/lib/server/db";

export const maxDuration = 300;

export const runtime = "nodejs";

/** ?format=csv (default, opens in Excel) or ?format=json (everything, for re-analysis). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await syncDb();
  const { id } = await params;
  const run = getRun(id);
  if (!run) return fail("Run not found", 404);
  const asJson = new URL(req.url).searchParams.get("format") === "json";
  return new Response(asJson ? JSON.stringify(run, null, 2) : toCsv(run), {
    headers: {
      "Content-Type": asJson ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="uebai-proof-${run.id}.${asJson ? "json" : "csv"}"`,
    },
  });
}
