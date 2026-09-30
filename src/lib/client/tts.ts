import { stripInternalIds } from "../text";

/**
 * Text-to-speech. Primary: Microsoft Edge neural voices rendered by /api/tts (works in any
 * browser). Fallback: the browser's speechSynthesis, preferring Edge's "Online (Natural)" voices.
 */

/** Edge neural voices offered in the Personality Lab (value = Edge ShortName). */
export const EDGE_VOICES: { id: string; name: { en: string; ar: string }; lang: "ar" | "en" }[] = [
  { id: "ar-SA-HamedNeural", name: { en: "Hamed — Saudi (male)", ar: "حامد — سعودي (ذكر)" }, lang: "ar" },
  { id: "ar-SA-ZariyahNeural", name: { en: "Zariyah — Saudi (female)", ar: "زارية — سعودية (أنثى)" }, lang: "ar" },
  { id: "ar-KW-FahedNeural", name: { en: "Fahed — Kuwaiti (male)", ar: "فهد — كويتي (ذكر)" }, lang: "ar" },
  { id: "ar-KW-NouraNeural", name: { en: "Noura — Kuwaiti (female)", ar: "نورة — كويتية (أنثى)" }, lang: "ar" },
  { id: "ar-QA-MoazNeural", name: { en: "Moaz — Qatari (male)", ar: "معاذ — قطري (ذكر)" }, lang: "ar" },
  { id: "ar-QA-AmalNeural", name: { en: "Amal — Qatari (female)", ar: "أمل — قطرية (أنثى)" }, lang: "ar" },
  { id: "ar-AE-HamdanNeural", name: { en: "Hamdan — Emirati (male)", ar: "حمدان — إماراتي (ذكر)" }, lang: "ar" },
  { id: "ar-AE-FatimaNeural", name: { en: "Fatima — Emirati (female)", ar: "فاطمة — إماراتية (أنثى)" }, lang: "ar" },
  { id: "ar-BH-AliNeural", name: { en: "Ali — Bahraini (male)", ar: "علي — بحريني (ذكر)" }, lang: "ar" },
  { id: "ar-OM-AbdullahNeural", name: { en: "Abdullah — Omani (male)", ar: "عبدالله — عُماني (ذكر)" }, lang: "ar" },
  { id: "ar-EG-ShakirNeural", name: { en: "Shakir — Egyptian (male)", ar: "شاكر — مصري (ذكر)" }, lang: "ar" },
  { id: "ar-EG-SalmaNeural", name: { en: "Salma — Egyptian (female)", ar: "سلمى — مصرية (أنثى)" }, lang: "ar" },
  { id: "en-US-AndrewNeural", name: { en: "Andrew — US (male)", ar: "أندرو — أمريكي (ذكر)" }, lang: "en" },
  { id: "en-US-AvaNeural", name: { en: "Ava — US (female)", ar: "آفا — أمريكية (أنثى)" }, lang: "en" },
  { id: "en-US-GuyNeural", name: { en: "Guy — US (male)", ar: "غاي — أمريكي (ذكر)" }, lang: "en" },
  { id: "en-GB-RyanNeural", name: { en: "Ryan — UK (male)", ar: "رايان — بريطاني (ذكر)" }, lang: "en" },
];

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu;

/** What the teacher should actually say: no emojis, citations, links, ids, code or Markdown symbols. */
export function speechText(md: string): string {
  return stripInternalIds(md)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) → label
    .replace(/\[[^\]]*\]/g, " ") // refs like [Biology 1 p.142]
    .replace(/https?:\/\/\S+/g, " ")
    .replace(EMOJI, " ")
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")
    .replace(/[#*_`>|~]/g, "")
    // Symbols voices read out loud ("minus", "colon", "slash"…) become pauses or disappear.
    .replace(/\s*[:;]\s*/g, "، ")
    .replace(/[-‐‑‒–—―−]+/g, " ")
    .replace(/[/\\=+→←↔⇒⇐•·●▪◦…]+/g, " ")
    .replace(/[«»"“”„'‘’()[\]{}]/g, " ")
    .replace(/\s*([،,.!?؟])(?:\s*[،,])+/g, "$1") // collapse pause runs like "، ،" or ".،"
    .replace(/^[\s،,]+|[\s،,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, preferredUri?: string | null): SpeechSynthesisVoice | null {
  if (preferredUri) {
    const chosen = voices.find((v) => v.voiceURI === preferredUri);
    if (chosen) return chosen;
  }
  const want = lang.toLowerCase();
  const base = want.slice(0, 2);
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.toLowerCase().replace("_", "-") === want ? 4 : 0) + (/natural/i.test(v.name) ? 3 : 0) + (/online/i.test(v.name) ? 1 : 0) + (/microsoft/i.test(v.name) ? 1 : 0);
  return voices.filter((v) => v.lang.toLowerCase().startsWith(base)).sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Voices load asynchronously on first use. */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Speak in sentence-sized pieces: the first starts sooner and online voices don't cut off. */
function chunks(text: string, max = 200): string[] {
  const out: string[] = [];
  let cur = "";
  for (const sentence of text.match(/[^.!?؟،;:\n]+[.!?؟،;:]*\s*/g) ?? [text]) {
    if (cur && (cur + sentence).length > max) { out.push(cur.trim()); cur = ""; }
    if (sentence.length > max) {
      for (const word of sentence.split(/(\s+)/)) {
        if ((cur + word).length > max && cur) { out.push(cur.trim()); cur = ""; }
        cur += word;
      }
    } else cur += sentence;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface SpeakOptions {
  lang: "ar" | "en";
  voiceId?: string | null;
  rate?: number;
  onStart?: () => void;
  onBoundary?: () => void;
  onEnd?: () => void;
}

let generation = 0;
let playing: HTMLAudioElement | null = null;

export function stopSpeaking() {
  generation++;
  playing?.pause();
  playing = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Returns false when there is nothing to say or speech isn't supported. */
export function speak(markdown: string, opts: SpeakOptions): boolean {
  if (typeof window === "undefined") return false;
  const text = speechText(markdown);
  if (!text) return false;
  stopSpeaking();
  const mine = generation;
  void speakNeural(text, opts, mine).catch(() => {
    if (mine === generation) speakBrowser(text, opts, mine);
  });
  return true;
}

async function fetchAudio(part: string, opts: SpeakOptions): Promise<string> {
  const voice = opts.voiceId && EDGE_VOICES.some((v) => v.id === opts.voiceId) ? opts.voiceId : undefined;
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: part, lang: opts.lang, voice, rate: opts.rate }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Plays Edge neural audio piece by piece, fetching the next piece while the current one plays. */
async function speakNeural(text: string, opts: SpeakOptions, mine: number) {
  const parts = chunks(text, 300);
  let next = fetchAudio(parts[0], opts);
  for (let i = 0; i < parts.length; i++) {
    let url: string;
    try { url = await next; } catch (err) {
      if (i === 0) throw err; // nothing spoken yet → caller falls back to browser voices
      playing = null;
      opts.onEnd?.();
      return;
    }
    if (i + 1 < parts.length) next = fetchAudio(parts[i + 1], opts);
    if (mine !== generation) { URL.revokeObjectURL(url); return; }
    const audio = new Audio(url);
    playing = audio;
    audio.ontimeupdate = () => opts.onBoundary?.();
    await audio.play();
    if (i === 0) opts.onStart?.();
    await new Promise<void>((resolve) => { audio.onended = () => resolve(); audio.onpause = () => resolve(); audio.onerror = () => resolve(); });
    URL.revokeObjectURL(url);
    if (mine !== generation) return;
  }
  playing = null;
  opts.onEnd?.();
}

function speakBrowser(text: string, opts: SpeakOptions, mine: number) {
  if (!("speechSynthesis" in window)) { opts.onEnd?.(); return; }
  const synth = window.speechSynthesis;
  void loadVoices().then((voices) => {
    if (mine !== generation) return;
    const lang = opts.lang === "ar" ? "ar-SA" : "en-US";
    const voice = pickVoice(voices, lang, opts.voiceId);
    const parts = chunks(text);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.rate = opts.rate ?? 1;
      u.onboundary = () => opts.onBoundary?.();
      if (i === 0) u.onstart = () => opts.onStart?.();
      if (i === parts.length - 1) { u.onend = () => opts.onEnd?.(); u.onerror = () => opts.onEnd?.(); }
      synth.speak(u);
    });
  });
}
