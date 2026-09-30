import type { Condition, ErrorKind, QuestionCategory, RunStatus } from "@/lib/bench/types";

/** Display names (English keys → Arabic via t()). */
export const COND_LABEL: Record<Condition, string> = {
  full: "Whole book",
  uebai: "UEBAI cards",
  rag: "Classic chunks",
  trunc: "Small window",
};

export const COND_HELP_LABEL: Record<Condition, string> = {
  full: "The entire book is given to the model with every question — what people do today with long-context models. If a model can't take it in one request, it reads the book in parts and combines the answers, so every page is always read.",
  uebai: "Only the topic cards the router opens, plus the three best book passages.",
  rag: "Classic retrieval: the book cut into equal 400-token pieces, the best ones picked by keywords — same size as UEBAI.",
  trunc: "Only what fits a small model's window, from the first page (the small-window setting below).",
};

export const COND_COLOR: Record<Condition, string> = { full: "#b3202a", uebai: "#2e7d4f", rag: "#3a6ea5", trunc: "#8a5a2e" };

export const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  fact: "Single fact",
  explain: "Explanation",
  multi: "Across pages",
  unanswerable: "Not in the book",
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  paused: "Paused",
  done: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const ERROR_KIND: Record<ErrorKind, string> = {
  too_large: "Too big for this model",
  quota_minute: "Rate limit",
  quota_day: "Daily quota used up",
  network: "Server busy / network",
  other: "Error",
};
