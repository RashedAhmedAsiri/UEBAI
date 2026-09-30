import type { ErrorKind } from "./types";

/** A failed benchmark call, classified so the runner knows whether to wait, retry, pause or record it. */
export class BenchError extends Error {
  constructor(message: string, public kind: ErrorKind, public retryAfterMs = 0) {
    super(message);
  }
}

interface ApiErrorBody {
  error?: {
    code?: number; message?: string; status?: string;
    details?: { "@type"?: string; violations?: { quotaId?: string; quotaMetric?: string; quotaValue?: string }[]; retryDelay?: string }[];
  };
}

/** Turns a Gemini API error response into a BenchError. */
export function geminiError(status: number, raw: string, promptTokensEst: number): BenchError {
  let body: ApiErrorBody = {};
  try { body = JSON.parse(raw) as ApiErrorBody; } catch { /* not JSON */ }
  let message = body.error?.message ?? (raw.slice(0, 300) || `HTTP ${status}`);
  const details = body.error?.details ?? [];
  const violations = details.flatMap((d) => d.violations ?? []);
  const retry = details.find((d) => d.retryDelay)?.retryDelay;
  const retryMs = retry ? Math.ceil(parseFloat(retry) * 1000) : 30_000;
  if (status === 429 || body.error?.status === "RESOURCE_EXHAUSTED") {
    // Name the limit that was hit (e.g. "GenerateContentInputTokensPerModelPerMinute-FreeTier = 250000").
    const which = violations.map((v) => `${v.quotaId ?? "?"}${v.quotaValue ? ` = ${v.quotaValue}` : ""}`).join("; ");
    if (which) message = `${message.split(". ")[0]}. [${which}]`;
    if (violations.some((v) => /PerDay/i.test(v.quotaId ?? ""))) return new BenchError(message, "quota_day");
    // A prompt bigger than the per-minute token allowance can never go through.
    const tokenLimit = violations.find((v) => /input_token/i.test(v.quotaMetric ?? "") && /PerMinute/i.test(v.quotaId ?? ""));
    if (tokenLimit?.quotaValue && Number(tokenLimit.quotaValue) < promptTokensEst) {
      return new BenchError(`Prompt (~${promptTokensEst} tokens) is over this model's per-minute token limit (${tokenLimit.quotaValue}).`, "too_large");
    }
    return new BenchError(message, "quota_minute", Math.max(5_000, retryMs));
  }
  if (status === 400 && /token|too long|exceed|context/i.test(message)) return new BenchError(message, "too_large");
  if (status >= 500) return new BenchError(message, "network", 10_000);
  return new BenchError(message, "other");
}

/** DeepSeek (OpenAI-style) errors: 400 bad/too long, 401 key, 402 no balance, 429 rate, 500/503 busy. */
export function deepseekError(status: number, raw: string): BenchError {
  let message = raw.slice(0, 300) || `HTTP ${status}`;
  try { message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? message; } catch { /* not JSON */ }
  if (status === 400 && /context length|maximum|too long|tokens/i.test(message)) return new BenchError(message, "too_large");
  if (status === 401) return new BenchError(`DeepSeek rejected the API key (${message})`, "other");
  // No balance left behaves like a used-up daily quota: pause the run until the account is topped up.
  if (status === 402) return new BenchError(`DeepSeek account balance is empty (${message})`, "quota_day");
  if (status === 429) return new BenchError(message, "quota_minute", 20_000);
  if (status >= 500) return new BenchError(message, "network", 10_000);
  return new BenchError(message, "other");
}

/** Largest prompt a model accepts, if the error message says so ("maximum context length is 131072 tokens"). */
export function limitFromMessage(message: string): number | null {
  const m = message.match(/(?:maximum context length is|token limit \(|limit:\s*)\s*(\d{4,})/i);
  return m ? Number(m[1]) : null;
}
