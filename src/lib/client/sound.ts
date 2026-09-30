"use client";
/** License-free UI sounds synthesized with the Web Audio API (jsfxr-style). */

export type SoundName = "click" | "clunk" | "drawer" | "tick" | "boot" | "happy" | "thinking" | "chalk" | "paper" | "stamp" | "pop" | "error";

let ctx: AudioContext | null = null;
let enabled = true;
let volume = 0.25;

export function setSoundEnabled(v: boolean) { enabled = v; }
export function isSoundEnabled() { return enabled; }

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, dur: number, type: OscillatorType = "square", gain = 1, slideTo?: number, delay = 0) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(volume * gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain = 1, filterFreq = 2000, delay = 0, q = 1) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = filterFreq; f.Q.value = q;
  const g = a.createGain(); g.gain.value = volume * gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

export function play(name: SoundName) {
  if (!enabled) return;
  switch (name) {
    case "click": tone(900, 0.04, "square", 0.35, 500); noise(0.03, 0.4, 3000); break;
    case "pop": tone(500, 0.08, "sine", 0.6, 1100); break;
    case "clunk": tone(140, 0.12, "square", 0.5, 70); noise(0.08, 0.8, 800); break;
    case "drawer": noise(0.28, 0.5, 600, 0, 0.7); tone(90, 0.1, "triangle", 0.5, 60, 0.24); break;
    case "tick": noise(0.015, 0.5, 5000, 0, 4); break;
    case "boot": [262, 330, 392, 523].forEach((f, i) => tone(f, 0.14, "square", 0.35, undefined, i * 0.09)); break;
    case "happy": [660, 880, 990].forEach((f, i) => tone(f, 0.09, "square", 0.3, undefined, i * 0.07)); break;
    case "thinking": tone(440, 0.06, "sine", 0.3); tone(520, 0.06, "sine", 0.3, undefined, 0.1); break;
    case "chalk": noise(0.05, 0.6, 4200, 0, 2); noise(0.04, 0.4, 3600, 0.06, 2); break;
    case "paper": noise(0.18, 0.35, 2500, 0, 0.5); break;
    case "stamp": tone(110, 0.1, "sine", 0.9, 55); noise(0.07, 0.9, 400); break;
    case "error": tone(220, 0.15, "sawtooth", 0.3, 160); tone(180, 0.2, "sawtooth", 0.3, 120, 0.12); break;
  }
}
