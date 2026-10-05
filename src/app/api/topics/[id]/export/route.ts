import { exportMarkdown } from "@/lib/server/library";
import { fail } from "@/lib/server/teachers";
import { syncDb } from "@/lib/server/db";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Topic as a Markdown file: front-matter = Tier 1, body = Tier 2, appendix = Tier 3 refs. */
export async function GET(_: Request, { params }: Ctx) {
  await syncDb();
  try {
    const { filename, body } = exportMarkdown((await params).id);
    return new Response(body, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` },
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 404);
  }
}
