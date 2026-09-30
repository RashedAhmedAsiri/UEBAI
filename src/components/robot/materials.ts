"use client";
import * as THREE from "three";

/**
 * Procedural PBR materials: albedo + bump + roughness maps painted on canvases at runtime.
 * The user's colour is a tint multiplied over the (mostly neutral) albedo texture.
 */
const SIZE = 512;
const texCache = new Map<string, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; rough: THREE.CanvasTexture }>();
const matCache = new Map<string, THREE.Material>();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas() {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  return c;
}

function toTex(c: HTMLCanvasElement, color = false, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noiseFill(ctx: CanvasRenderingContext2D, base: number, amp: number, r: () => number) {
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = base + (r() - 0.5) * amp;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Wear: chipped paint / rust spots painted onto albedo, bump and roughness. */
function paintWear(a: CanvasRenderingContext2D, b: CanvasRenderingContext2D, rr: CanvasRenderingContext2D, wear: number, r: () => number, rust: boolean) {
  const n = Math.round(wear * 70);
  for (let i = 0; i < n; i++) {
    const x = r() * SIZE, y = r() * SIZE, rad = 2 + r() * 10 * (0.5 + wear);
    const g = a.createRadialGradient(x, y, 0, x, y, rad);
    if (rust) { g.addColorStop(0, "rgba(140,62,20,.95)"); g.addColorStop(1, "rgba(120,60,20,0)"); }
    else { g.addColorStop(0, "rgba(150,150,150,.95)"); g.addColorStop(0.7, "rgba(90,90,90,.6)"); g.addColorStop(1, "rgba(90,90,90,0)"); }
    a.fillStyle = g; a.beginPath(); a.arc(x, y, rad, 0, Math.PI * 2); a.fill();
    b.fillStyle = "rgba(0,0,0,.5)"; b.beginPath(); b.arc(x, y, rad * 0.8, 0, Math.PI * 2); b.fill();
    rr.fillStyle = rust ? "rgba(255,255,255,.9)" : "rgba(80,80,80,.8)"; rr.beginPath(); rr.arc(x, y, rad * 0.8, 0, Math.PI * 2); rr.fill();
  }
}

function makeTextures(kind: string, wearBucket: number) {
  const key = `${kind}:${wearBucket}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const r = rng(kind.length * 977 + wearBucket * 31);
  const A = canvas(), B = canvas(), R = canvas();
  const a = A.getContext("2d")!, b = B.getContext("2d")!, rr = R.getContext("2d")!;
  let repeat = 1;

  switch (kind) {
    case "brushed_steel": {
      noiseFill(b, 128, 20, r);
      for (let y = 0; y < SIZE; y++) {
        const v = 200 + (r() - 0.5) * 40;
        a.fillStyle = `rgb(${v},${v + 2},${v + 4})`; a.fillRect(0, y, SIZE, 1);
        b.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},0,0,.25)`; b.fillRect(0, y, SIZE, 1);
      }
      noiseFill(rr, 90, 30, r);
      repeat = 2;
      break;
    }
    case "wood_panel": {
      for (let y = 0; y < SIZE; y++) {
        const wave = Math.sin(y * 0.09 + Math.sin(y * 0.013) * 4) * 0.5 + 0.5;
        const v = 0.55 + wave * 0.35 + (r() - 0.5) * 0.08;
        a.fillStyle = `rgb(${Math.round(160 * v + 40)},${Math.round(100 * v + 25)},${Math.round(50 * v + 10)})`;
        a.fillRect(0, y, SIZE, 1);
        b.fillStyle = `rgb(${Math.round(wave * 255)},0,0)`; b.fillRect(0, y, SIZE, 1);
      }
      noiseFill(rr, 180, 30, r);
      break;
    }
    case "carbon_fiber": {
      const s = 16;
      for (let y = 0; y < SIZE; y += s) for (let x = 0; x < SIZE; x += s) {
        const alt = ((x + y) / s) % 2 === 0;
        const g = alt ? a.createLinearGradient(x, y, x + s, y) : a.createLinearGradient(x, y, x, y + s);
        g.addColorStop(0, "#1a1a1a"); g.addColorStop(0.5, "#4a4a4a"); g.addColorStop(1, "#1a1a1a");
        a.fillStyle = g; a.fillRect(x, y, s, s);
        b.fillStyle = alt ? "#aaa" : "#555"; b.fillRect(x, y, s, s);
      }
      noiseFill(rr, 70, 20, r);
      repeat = 2;
      break;
    }
    case "rubber": {
      noiseFill(a, 60, 18, r);
      noiseFill(b, 128, 90, r);
      noiseFill(rr, 235, 20, r);
      break;
    }
    case "rusty_iron": {
      noiseFill(a, 110, 40, r);
      noiseFill(b, 128, 80, r);
      noiseFill(rr, 200, 50, r);
      paintWear(a, b, rr, Math.max(0.6, wearBucket / 4), r, true);
      break;
    }
    case "toy_plastic":
    case "gold":
    case "polished_chrome": {
      a.fillStyle = "#fff"; a.fillRect(0, 0, SIZE, SIZE);
      noiseFill(b, 128, 4, r);
      noiseFill(rr, kind === "toy_plastic" ? 60 : 30, 10, r);
      break;
    }
    default: { // painted_enamel, copper, brass
      a.fillStyle = "#fff"; a.fillRect(0, 0, SIZE, SIZE);
      a.globalAlpha = 0.12; noiseFill(a, 235, 40, r); a.globalAlpha = 1;
      noiseFill(b, 128, 14, r);
      noiseFill(rr, kind === "painted_enamel" ? 110 : 80, 30, r);
    }
  }
  if (wearBucket > 0 && kind !== "rusty_iron") paintWear(a, b, rr, wearBucket / 4, r, kind === "brushed_steel" || kind === "copper");
  const out = { map: toTex(A, true, repeat), bump: toTex(B, false, repeat), rough: toTex(R, false, repeat) };
  texCache.set(key, out);
  return out;
}

const BASE: Record<string, { color: string; metal: number; rough: number; tintable: boolean; clearcoat?: number }> = {
  polished_chrome: { color: "#ffffff", metal: 1, rough: 0.12, tintable: false },
  brushed_steel: { color: "#dfe3e6", metal: 0.9, rough: 0.38, tintable: true },
  painted_enamel: { color: "#ffffff", metal: 0.1, rough: 0.4, tintable: true, clearcoat: 0.4 },
  toy_plastic: { color: "#ffffff", metal: 0, rough: 0.28, tintable: true, clearcoat: 0.8 },
  copper: { color: "#d98a55", metal: 1, rough: 0.3, tintable: false },
  brass: { color: "#e2bb5a", metal: 1, rough: 0.28, tintable: false },
  gold: { color: "#ffcc4a", metal: 1, rough: 0.18, tintable: false },
  rusty_iron: { color: "#ffffff", metal: 0.55, rough: 0.8, tintable: false },
  wood_panel: { color: "#ffffff", metal: 0, rough: 0.6, tintable: false, clearcoat: 0.3 },
  carbon_fiber: { color: "#ffffff", metal: 0.3, rough: 0.35, tintable: false, clearcoat: 0.9 },
  rubber: { color: "#ffffff", metal: 0, rough: 0.9, tintable: true },
};

export function robotMaterial(kind = "painted_enamel", tint?: string, wear = 0): THREE.Material {
  const spec = BASE[kind] ?? BASE.painted_enamel;
  const bucket = Math.round(Math.min(1, Math.max(0, wear)) * 4);
  const key = `${kind}|${spec.tintable ? tint ?? "" : ""}|${bucket}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const tex = makeTextures(kind, bucket);
  const color = new THREE.Color(spec.color);
  if (spec.tintable && tint) color.multiply(new THREE.Color(tint));
  const mat = new THREE.MeshPhysicalMaterial({
    color, metalness: spec.metal, roughness: spec.rough, map: tex.map, bumpMap: tex.bump, bumpScale: kind === "rubber" ? 3 : 1.2,
    roughnessMap: tex.rough, clearcoat: spec.clearcoat ?? 0, clearcoatRoughness: 0.2,
  });
  matCache.set(key, mat);
  return mat;
}

/** Simple coloured material for wardrobe items (cloth gets a weave bump). */
const clothTex: { t?: THREE.CanvasTexture } = {};
export function clothMaterial(color: string): THREE.Material {
  const key = `cloth|${color}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  if (!clothTex.t) {
    const c = canvas(), x = c.getContext("2d")!;
    for (let y = 0; y < SIZE; y += 4) for (let i = 0; i < SIZE; i += 4) {
      x.fillStyle = ((y + i) / 4) % 2 ? "#9a9a9a" : "#6a6a6a"; x.fillRect(i, y, 4, 4);
    }
    clothTex.t = toTex(c, false, 6);
  }
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, bumpMap: clothTex.t, bumpScale: 0.6, side: THREE.DoubleSide });
  matCache.set(key, m);
  return m;
}

export function solidMaterial(color: string, opts: { metal?: number; rough?: number; emissive?: string; transparent?: number } = {}): THREE.Material {
  const key = `solid|${color}|${JSON.stringify(opts)}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshPhysicalMaterial({
    color, metalness: opts.metal ?? 0.1, roughness: opts.rough ?? 0.4,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined, emissiveIntensity: opts.emissive ? 1.2 : 0,
    transparent: opts.transparent !== undefined, opacity: opts.transparent ?? 1,
    transmission: opts.transparent !== undefined ? 0.6 : 0, thickness: 0.2,
  });
  matCache.set(key, m);
  return m;
}
