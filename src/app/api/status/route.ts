import { isLive } from "@/lib/ai/provider";
import { MODELS } from "@/lib/ai/models";
import { json } from "@/lib/server/teachers";

export async function GET() {
  return json({ live: isLive(), models: MODELS });
}
