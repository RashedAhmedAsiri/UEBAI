import "server-only";

/**
 * Minimal Upstash Redis REST client (plain fetch, no SDK). Used only when the site is hosted
 * (Vercel): the serverless filesystem is temporary, so the database and uploaded files live here.
 * The Vercel ↔ Upstash integration sets KV_REST_API_URL/KV_REST_API_TOKEN; the Upstash console
 * names them UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. Either pair works.
 */
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

/** True when data lives in Redis instead of ./data (i.e. on Vercel). */
export function hosted(): boolean {
  return Boolean(URL_ && TOKEN);
}

/** Proof Lab runs write result files, which a hosted site cannot keep. */
export const BENCH_LOCAL_ONLY = "The Proof Lab only runs experiments on your own computer. The online site shows saved results.";

type Cmd = (string | number)[];

async function post<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(URL_.replace(/\/$/, "") + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as T | { error?: string } | null;
      if (!res.ok) throw new Error(`Storage error ${res.status}: ${(data as { error?: string } | null)?.error ?? res.statusText}`);
      return data as T;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

export async function kv<T = unknown>(...cmd: Cmd): Promise<T> {
  const data = await post<{ result?: T; error?: string }>("", cmd);
  if (data.error) throw new Error(`Storage error: ${data.error}`);
  return data.result as T;
}

/** Several commands in one round trip (not atomic). */
export async function kvPipeline(cmds: Cmd[]): Promise<unknown[]> {
  if (!cmds.length) return [];
  const data = await post<{ result?: unknown; error?: string }[]>("/pipeline", cmds);
  const err = data.find((r) => r.error);
  if (err) throw new Error(`Storage error: ${err.error}`);
  return data.map((r) => r.result);
}
