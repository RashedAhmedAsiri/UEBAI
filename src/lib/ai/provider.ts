import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, provider, supportsEffort, type ModelRole } from "./models";
import { GeminiError, geminiClient } from "./gemini";
import { extractJson } from "../text";

/**
 * Single provider interface for every LLM call in the app. Swap vendors here.
 * When no credentials are configured the app runs in DEMO MODE and callers use
 * their offline fallbacks (see isLive()).
 */
type G = typeof globalThis & { __roboprofClient?: Anthropic };
const g = globalThis as G;

export function isLive(): boolean {
  return provider() !== "none" || Boolean(process.env.ROBOPROF_FORCE_LIVE);
}

export function client(): Anthropic {
  // The Gemini adapter is a stateless wrapper; building it per call means code reloads take effect.
  if (provider() === "gemini") return geminiClient();
  g.__roboprofClient ??= new Anthropic({ maxRetries: 3 });
  return g.__roboprofClient;
}

export interface Usage { input: number; output: number; cacheRead: number }

export interface CompleteOpts {
  role: ModelRole;
  system?: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export async function complete(opts: CompleteOpts): Promise<{ text: string; usage: Usage }> {
  const model = MODELS[opts.role];
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: opts.maxTokens ?? 8000,
    messages: opts.messages,
    ...(opts.system ? { system: opts.system } : {}),
    ...(supportsEffort(model) ? { output_config: { effort: opts.effort ?? "low" } } : {}),
  };
  // Stream + finalMessage so long outputs never hit HTTP timeouts.
  const msg = await client().messages.stream(params).finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined this request.");
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  return {
    text,
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens, cacheRead: msg.usage.cache_read_input_tokens ?? 0 },
  };
}

/** Ask for JSON; parse tolerantly; retry once with the parse error fed back. */
export async function completeJson<T>(opts: CompleteOpts, validate?: (x: unknown) => T): Promise<{ data: T; usage: Usage }> {
  let last: unknown;
  const messages = [...opts.messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, usage } = await complete({ ...opts, messages });
    try {
      const raw = extractJson(text);
      return { data: validate ? validate(raw) : (raw as T), usage };
    } catch (err) {
      last = err;
      messages.push({ role: "assistant", content: text || "(empty)" });
      messages.push({ role: "user", content: `That was not valid JSON (${String(err)}). Reply with the JSON only.` });
    }
  }
  throw last instanceof Error ? last : new Error("Model did not return valid JSON");
}

/** Friendly message for UI from an SDK error. */
export function describeAiError(err: unknown): string {
  if (err instanceof GeminiError) {
    if (err.status === 0) return "Could not reach the AI provider (network).";
    if (err.status === 401 || err.status === 403 || /api key/i.test(err.message)) return "The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.";
    if (err.status === 429 && err.message.startsWith("daily:")) return "Gemini's free daily limit is used up — it resets tomorrow.";
    if (err.status === 429) return "Gemini free-tier limit reached — wait a minute and try again.";
    if (err.status === 400) return `The AI request was rejected: ${err.message}`;
    return `AI provider error ${err.status}: ${err.message}`;
  }
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the AI provider — try again in a moment.";
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI provider (network).";
  if (err instanceof Anthropic.APIError) return `AI provider error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
