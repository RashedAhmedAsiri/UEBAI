import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { fail } from "@/lib/server/teachers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Neural voices from Microsoft Edge's Read Aloud service (the voices Edge itself uses). */
const DEFAULT_VOICE = { ar: "ar-BH-AliNeural", en: "en-US-AndrewNeural" } as const;
const TIMEOUT_MS = 20_000;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Speed multiplier (0.5–2) → SSML relative percentage. */
function ratePercent(rate: unknown): string {
  const r = Math.min(2, Math.max(0.5, Number(rate) || 1));
  const pct = Math.round((r - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** Body: { text, lang: "ar" | "en", voice?: Edge ShortName, rate?: number } → audio/mpeg. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; lang?: string; voice?: string; rate?: number };
  const text = String(body.text ?? "").trim().slice(0, 3000);
  if (!text) return fail("Nothing to say");
  const voice = typeof body.voice === "string" && /^[a-z]{2,3}-[A-Z]{2}-\w+Neural$/.test(body.voice)
    ? body.voice
    : DEFAULT_VOICE[body.lang === "en" ? "en" : "ar"];

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text), { rate: ratePercent(body.rate) });
    const audio = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => reject(new Error("TTS timed out")), TIMEOUT_MS);
      audioStream.on("data", (d: Buffer) => chunks.push(d));
      audioStream.on("error", (e) => { clearTimeout(timer); reject(e); });
      audioStream.on("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    });
    if (!audio.length) return fail("Voice service unavailable", 502);
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[tts] failed", err);
    return fail("Voice service unavailable", 502);
  } finally {
    tts.close();
  }
}
