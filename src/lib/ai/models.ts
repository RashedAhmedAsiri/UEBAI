export type Provider = "anthropic" | "gemini" | "none";

/** ROBOPROF_PROVIDER wins; otherwise whichever key is present (Anthropic first). */
export function provider(): Provider {
  const p = process.env.ROBOPROF_PROVIDER;
  if (p === "anthropic" || p === "gemini") return p;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "none";
}

const GEMINI = provider() === "gemini";

/** Env override, ignoring one written for the other vendor. */
function pick(envValue: string | undefined, claude: string, gemini: string) {
  if (envValue && envValue.startsWith("gemini") === GEMINI) return envValue;
  return GEMINI ? gemini : claude;
}

// Model roles are config, not hard-coded. Verify IDs/prices at https://docs.claude.com or
// https://ai.google.dev/gemini-api/docs/models before changing.
export const MODELS = {
  teacher: pick(process.env.ROBOPROF_MODEL_TEACHER, "claude-sonnet-5", "gemini-3.8-flash"), // answers in character
  // Book ingestion makes one notes call per topic, far past gemini-3.8-flash's 20/day free quota.
  notes: pick(process.env.ROBOPROF_MODEL_NOTES, "claude-sonnet-5", "gemini-3.5-flash-lite"), // Tier-2 study notes
  // Own quota, separate from book ingestion, so questions don't queue behind an upload.
  router: pick(process.env.ROBOPROF_MODEL_ROUTER, "claude-haiku-4-5", "gemini-3.1-flash-lite"), // topic routing
  digest: pick(process.env.ROBOPROF_MODEL_DIGEST, "claude-haiku-4-5", "gemini-3.5-flash-lite"), // topic detection, merge judge, index cards
};
export type ModelRole = keyof typeof MODELS;

/** USD per 1M tokens [input, output] — used for pre-ingestion cost estimates. */
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-opus-5": [5, 25],
};

export function price(model: string): [number, number] {
  if (model.startsWith("gemini")) return [0, 0]; // Google AI Studio free tier
  return PRICES[model] ?? [3, 15];
}

/** Haiku 4.5 rejects `effort`; the 5-series accepts it. */
export function supportsEffort(model: string) {
  return !model.includes("haiku");
}

/** web_search_20260209 needs a 4.6+/5-series model; older ones use the basic variant. */
export function webSearchToolType(model: string) {
  return model.includes("haiku") ? "web_search_20250305" : "web_search_20260209";
}
