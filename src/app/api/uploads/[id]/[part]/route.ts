import { fail, json } from "@/lib/server/teachers";
import { MAX_PARTS, PART_BYTES, putUploadPart, validUpload } from "@/lib/server/files";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; part: string }> };

/** One part of a file upload (raw bytes). The sources route assembles the parts afterwards. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id, part } = await params;
  const n = Number(part);
  if (!validUpload(id, n + 1) || n >= MAX_PARTS) return fail("Bad upload part");
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > PART_BYTES) return fail("Bad upload part");
  await putUploadPart(id, n, buf);
  return json({ ok: true });
}
