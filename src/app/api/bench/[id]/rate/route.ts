import { fail, json } from "@/lib/server/teachers";
import { addRating, blindItems, getRun } from "@/lib/server/bench/runner";
import { ZodError } from "zod";
import { syncDb } from "@/lib/server/db";
import { BENCH_LOCAL_ONLY, hosted } from "@/lib/server/kv";

export const maxDuration = 300;

export const runtime = "nodejs";

/** Blind rating sheet for one rater: answers without system names, shuffled per rater. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await syncDb();
  const { id } = await params;
  const run = getRun(id);
  if (!run) return fail("Run not found", 404);
  const rater = (new URL(req.url).searchParams.get("rater") ?? "").trim().slice(0, 60);
  if (!rater) return fail("Write your name first");
  return json({ items: blindItems(run, rater), dataset: run.dataset.name });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await syncDb();
  if (hosted()) return fail(BENCH_LOCAL_ONLY);
  const { id } = await params;
  try {
    return json({ rating: addRating(id, await req.json().catch(() => null)) });
  } catch (e) {
    return fail(e instanceof ZodError ? "Give every answer a score from 1 to 5" : (e as Error).message);
  }
}
