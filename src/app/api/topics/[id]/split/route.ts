import { splitTopic } from "@/lib/server/library";
import { fail, json } from "@/lib/server/teachers";
import { describeAiError } from "@/lib/ai/provider";
import { syncDb } from "@/lib/server/db";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  await syncDb();
  const { titles } = (await req.json()) as { titles?: string[] };
  try {
    return json({ job: await splitTopic((await params).id, titles ?? []) });
  } catch (err) {
    return fail(describeAiError(err));
  }
}
