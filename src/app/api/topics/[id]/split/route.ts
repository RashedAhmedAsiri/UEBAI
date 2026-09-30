import { splitTopic } from "@/lib/server/library";
import { fail, json } from "@/lib/server/teachers";
import { describeAiError } from "@/lib/ai/provider";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { titles } = (await req.json()) as { titles?: string[] };
  try {
    return json({ job: await splitTopic((await params).id, titles ?? []) });
  } catch (err) {
    return fail(describeAiError(err));
  }
}
