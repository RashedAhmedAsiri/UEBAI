/** Pure router-reply parsing (unit-tested). */
import { normalizeForSearch } from "../text";

export type RouteDecision = "topics" | "same_as_before" | "none" | "off_subject" | "chitchat";

export interface RouteResult {
  decision: RouteDecision;
  topic_ids: string[];
  needs_detail: boolean;
  search_query: string;
}

const DECISIONS: RouteDecision[] = ["topics", "same_as_before", "none", "off_subject", "chitchat"];

export function parseRoute(raw: unknown, validIds: Set<string>, question: string): RouteResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let decision = String(r.decision ?? "").toLowerCase() as RouteDecision;
  if (!DECISIONS.includes(decision)) decision = "none";
  const ids = (Array.isArray(r.topic_ids) ? r.topic_ids : []).map(String).filter((id) => validIds.has(id));
  const topic_ids = [...new Set(ids)].slice(0, 3);
  if (decision === "topics" && !topic_ids.length) decision = "none";
  return {
    decision,
    topic_ids,
    needs_detail: Boolean(r.needs_detail),
    search_query: typeof r.search_query === "string" && r.search_query.trim() ? r.search_query : question,
  };
}

// Matched against normalizeForSearch() output: lower-case, no diacritics/tatweel, أإآ→ا, ى→ي, ة→ه, no punctuation.
const CHITCHAT = /^(hi|hello|hey|yo|salam|thanks|thank you|how are you|good (morning|night|evening)|bye|السلام|مرحبا|اهلا|هلا|شكرا|كيف حالك|صباح الخير|مساء الخير|مع السلامه)(\s|$)/;
const FOLLOW_UP = /^(explain (that|it|this)|again|simpler|more|why$|and |what about|another example|give (me )?(an|another) example|can you elaborate|اشرح (ذلك|هذا|ذالك)|اعد|ابسط|بشكل ابسط|وضح|اعطني مثالا|مثالا اخر|مثال اخر|لماذا$|وماذا عن)/;

/** Offline heuristic used in demo mode and as a pre-filter. */
export function heuristicRoute(question: string, hasActive: boolean): RouteDecision | null {
  const q = normalizeForSearch(question);
  if (CHITCHAT.test(q) && q.length < 40) return "chitchat";
  if (hasActive && FOLLOW_UP.test(q)) return "same_as_before";
  return null;
}
