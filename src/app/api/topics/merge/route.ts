import { manualMerge } from "@/lib/server/library";
import { fail, json } from "@/lib/server/teachers";

export async function POST(req: Request) {
  const { from, into } = (await req.json()) as { from?: string; into?: string };
  if (!from || !into) return fail("Need {from, into}");
  try {
    return json({ job: manualMerge(from, into) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
