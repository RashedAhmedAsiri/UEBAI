/** Pure canonicalization decisions (§9.5). Thresholds are config; tune with the eval. */
export const MERGE_THRESHOLDS = {
  merge: Number(process.env.ROBOPROF_MERGE_HIGH ?? 0.9),
  judge: Number(process.env.ROBOPROF_MERGE_LOW ?? 0.75),
};

export type Relation = "SAME" | "A_CONTAINS_B" | "B_CONTAINS_A" | "RELATED" | "DIFFERENT";

export type Decision = "confirm_merge" | "judge" | "new";

export function decideBySimilarity(sim: number, t = MERGE_THRESHOLDS): Decision {
  if (sim >= t.merge) return "confirm_merge";
  if (sim >= t.judge) return "judge";
  return "new";
}

/** Offline stand-in for the LLM judge (demo mode). */
export function offlineJudge(sim: number, decision: Decision): Relation {
  if (decision === "confirm_merge") return "SAME";
  if (decision === "judge") return sim >= 0.82 ? "SAME" : "RELATED";
  return "DIFFERENT";
}

/** After a quick confirm for a ≥0.90 match, only an explicit DIFFERENT/RELATED blocks the merge. */
export function resolveConfirm(rel: Relation): Relation {
  return rel === "DIFFERENT" || rel === "RELATED" ? rel : rel === "SAME" ? "SAME" : rel;
}

export function isRelation(x: unknown): x is Relation {
  return x === "SAME" || x === "A_CONTAINS_B" || x === "B_CONTAINS_A" || x === "RELATED" || x === "DIFFERENT";
}

/** Replace "B1"-style source labels in refs like [B1 p.142; B2 p.88] with real source labels. */
export function relabelRefs(notes: string, labels: string[]): string {
  return notes.replace(/\[([^\]]*?\bB\d+\s*p\.[^\]]*)\]/g, (_, inner: string) =>
    "[" + inner.replace(/\bB(\d+)(?=\s*p\.)/g, (m, n) => labels[Number(n) - 1] ?? m) + "]",
  );
}
