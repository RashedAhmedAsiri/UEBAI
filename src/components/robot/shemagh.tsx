"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { clothMaterial } from "./materials";
import { garmentPoint, yokeY, type GarmentShape, type Section } from "./garments";
import type { WearCtx } from "./wardrobe";

/**
 * Saudi shemagh (red-and-white) or ghutra (white), worn the traditional way: the square cloth is folded into a
 * triangle over a taqiyah; the fold frames the face and crosses the forehead, the two ends rest on the chest,
 * the back falls to a point between the shoulders, and a black double-ring agal with two tasselled cords at the
 * back holds it on the crown.
 *
 * The cloth is built from each head model's real cross-sections (so it never cuts into a head) and lands on the
 * outer garment's shoulders. Coordinates: head-local units (the head group is scaled by headSize), then shifted
 * into the head_top group. θ/φ = 0 is the front (+z), π/2 the robot's left (+x).
 */

const M = 0.035; // taqiyah + cloth thickness over the head
const TOP_M = 0.045; // extra over the crown (vents, pull tabs)
const AGAL_R = 0.0175;

interface Cross { a: number; f: number; b: number; n: number }
const NONE: Cross = { a: 0, f: 0, b: 0, n: 2 };
const sq = (x: number) => x * x;
const root = (x: number) => Math.sqrt(Math.max(0, x));
const maxCross = (...cs: Cross[]): Cross => cs.reduce((m, c) => ({ a: Math.max(m.a, c.a), f: Math.max(m.f, c.f), b: Math.max(m.b, c.b), n: Math.min(m.n, c.n) }), { ...NONE, n: 99 });
const round = (r: number): Cross => ({ a: r, f: r, b: r, n: 2 });
/** Rounded-box corner inset near the top/bottom face. */
const inset = (y: number, flat: number, r: number) => (Math.abs(y) > flat ? r - root(sq(r) - sq(Math.abs(y) - flat)) : 0);

/** Horizontal cross-section of each head model at height y (head-local), matching parts.tsx. */
function headCross(variant: string, y: number): Cross {
  switch (variant) {
    case "dome": {
      const rs = 0.38 * root(1 - sq(y / 0.3116));
      return maxCross({ a: rs, f: 0.95 * rs, b: 0.95 * rs, n: 2 }, Math.abs(y) < 0.014 ? round(0.394) : NONE, y > -0.295 && y < -0.205 ? round(0.337) : NONE);
    }
    case "crt_tv": {
      if (Math.abs(y) > 0.32) return NONE;
      const i = inset(y, 0.26, 0.06);
      return { a: 0.42 - i, f: 0.345 - i, b: 0.38 - i, n: 6 };
    }
    case "capsule": {
      if (Math.abs(y) > 0.3) return NONE;
      const h = root(0.09 - y * y);
      return { a: 0.13 + h + 0.004, f: h, b: h, n: 3 };
    }
    case "tin_can":
      return Math.abs(y) > 0.315 ? NONE : round(0.357);
    case "lightbulb": {
      if (y > 0.46 || y < -0.39) return NONE;
      return maxCross(round(root(0.1444 - sq(y - 0.08))), y < -0.21 ? round(0.18) : NONE);
    }
    case "saucer": {
      const disc = Math.abs(y) < 0.1728 ? 0.48 * root(1 - sq(y / 0.1728)) : 0;
      const dome = y >= 0.1 ? root(0.0784 - sq(y - 0.1)) : 0;
      return maxCross(round(disc), round(dome), Math.abs(y + 0.04) < 0.028 ? round(0.458) : NONE);
    }
    case "radio": {
      if (Math.abs(y) > 0.29) return NONE;
      const i = inset(y, 0.17, 0.12);
      return { a: 0.41 - i, f: 0.2 - i, b: 0.2 - i, n: 5 };
    }
    default: { // cube (side rivets included)
      if (Math.abs(y) > 0.3) return NONE;
      const i = inset(y, 0.22, 0.08);
      return { a: 0.372 - i, f: 0.31 - i, b: 0.3 - i, n: 6 };
    }
  }
}

/** Distance from the head axis to a superellipse cross-section in direction φ. */
function crossRadius(c: Cross, phi: number) {
  if (c.a <= 0) return 0;
  const cz = Math.cos(phi);
  const sx = Math.abs(Math.sin(phi)) / c.a, sz = Math.abs(cz) / Math.max(1e-4, cz >= 0 ? c.f : c.b);
  return 1 / Math.pow(Math.pow(sx, c.n) + Math.pow(sz, c.n), 1 / c.n);
}

/* ------------------------------------------------------------------ textures */
let tex: { check: THREE.CanvasTexture; plain: THREE.CanvasTexture; border: THREE.CanvasTexture; borderPlain: THREE.CanvasTexture } | null = null;
const TILE = 0.19; // world size of one texture tile (8 diagonal check cells across)

function canvasTex(draw: (x: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 256) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Fine woven noise so the cloth doesn't look like plastic. */
function weave(x: CanvasRenderingContext2D, w: number, h: number) {
  for (let yy = 0; yy < h; yy += 2) { x.fillStyle = `rgba(0,0,0,${yy % 4 ? 0.025 : 0.05})`; x.fillRect(0, yy, w, 1); }
  for (let xx = 0; xx < w; xx += 2) { x.fillStyle = `rgba(0,0,0,${xx % 4 ? 0.02 : 0.04})`; x.fillRect(xx, 0, 1, h); }
}

function textures() {
  if (tex) return tex;
  const RED = "#B3141F", WHITE = "#FBFAF6";
  // Shemagh houndstooth-style check, laid on the diagonal: the square is folded corner to corner, so on the head
  // its weave runs at 45° to the forehead fold. The lattice (16 px steps along both diagonals) tiles the canvas.
  const check = canvasTex((x, w, h) => {
    x.fillStyle = WHITE; x.fillRect(0, 0, w, h);
    x.fillStyle = RED;
    for (let j = -1; j <= h / 16 + 1; j++) for (let i = -1; i <= w / 16 + 1; i++) {
      if ((i + j) % 2) continue;
      const cx = i * 16, cy = j * 16;
      x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4);
      x.fillRect(-7, -7, 14, 14); // the check
      x.fillRect(7, -7, 3, 3); x.fillRect(-10, 4, 3, 3); // houndstooth "teeth" on opposite corners
      x.restore();
    }
    weave(x, w, h);
  });
  const plain = canvasTex((x, w, h) => { x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, w, h); weave(x, w, h); });
  // Hem border band (u along the hem, v across): the woven edge pattern of a shemagh.
  const border = canvasTex((x, w, h) => {
    x.fillStyle = WHITE; x.fillRect(0, 0, w, h);
    x.fillStyle = RED;
    x.fillRect(0, h - 10, w, 10); // solid selvedge line at the very edge
    x.fillRect(0, h * 0.18, w, 4); x.fillRect(0, h * 0.62, w, 4);
    for (let i = 0; i < w; i += 32) { // larger band motif between the two lines
      x.save(); x.translate(i + 16, h * 0.4); x.rotate(Math.PI / 4); x.fillRect(-9, -9, 18, 18); x.restore();
      x.fillRect(i, h * 0.4 - 2, 32, 4);
    }
    weave(x, w, h);
  }, 256, 64);
  const borderPlain = canvasTex((x, w, h) => {
    x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(0,0,0,0.06)"; x.fillRect(0, h - 10, w, 3); x.fillRect(0, h * 0.3, w, 2); // tone-on-tone woven border
    weave(x, w, h);
  }, 256, 64);
  tex = { check, plain, border, borderPlain };
  return tex;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function clothMat(kind: "body" | "border" | "pipe", white: boolean, repeat?: [number, number]) {
  const key = `${kind}|${white}|${repeat?.join("x") ?? ""}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const t = textures();
  let map = kind === "border" ? (white ? t.borderPlain : t.border) : white ? t.plain : t.check;
  if (repeat) { map = map.clone(); map.repeat.set(repeat[0], repeat[1]); map.needsUpdate = true; }
  const m = new THREE.MeshStandardMaterial({
    map, roughness: 0.82, metalness: 0, side: THREE.DoubleSide,
    ...(kind === "border" ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
  });
  matCache.set(key, m);
  return m;
}

/* ------------------------------------------------------------------ geometry */
type V = THREE.Vector3;

function gridGeometry(rows: V[][], uvs: [number, number][][]): THREE.BufferGeometry {
  const cols = rows[0].length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  rows.forEach((r, ri) => {
    r.forEach((p, ci) => { pos.push(p.x, p.y, p.z); uv.push(uvs[ri][ci][0], uvs[ri][ci][1]); });
    if (ri > 0) {
      const a = (ri - 1) * cols, b = ri * cols;
      for (let c = 0; c < cols - 1; c++) idx.push(a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Arc lengths along a polyline. */
function cumulative(pts: V[]) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return out;
}

/** Point at arc length `d` along a polyline. */
function at(pts: V[], acc: number[], d: number): V {
  if (d <= 0) return pts[0].clone();
  for (let i = 1; i < pts.length; i++) if (acc[i] >= d) return pts[i - 1].clone().lerp(pts[i], (d - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]));
  return pts[pts.length - 1].clone();
}

/** Resample a polyline to n evenly spaced points. */
function resample(pts: V[], n: number) {
  const acc = cumulative(pts), L = acc[acc.length - 1];
  return Array.from({ length: n }, (_, i) => at(pts, acc, (L * i) / (n - 1)));
}

export type OuterShapeFor = (ctx: WearCtx, topId: string | null) => { sec: Section; outer: GarmentShape };

export interface ShemaghParts {
  cap: THREE.BufferGeometry; band: THREE.BufferGeometry; drape: THREE.BufferGeometry; hem: THREE.BufferGeometry;
  fold: THREE.TubeGeometry; foldLen: number; agal: THREE.TubeGeometry[]; cords: { tube: THREE.TubeGeometry; end: V; dir: V }[];
}

/** Everything is computed in head_top-local coordinates. Exported for tests. */
export function buildShemagh(ctx: WearCtx, sec: Section, outer: GarmentShape): ShemaghParts {
  const variant = ctx.headVariant ?? "cube";
  const body = ctx.body ?? { hs: 1, gap: 0.165, W: 1, D: 1 };
  const top = ctx.headTop, bottom = ctx.headBottom, lift = -top; // head-local → head_top-local
  const [sw, sh] = ctx.screen;
  const bezelW = (sw + 0.08) / 2, bezelTop = (sh + 0.08) / 2, bezelBack = ctx.headFront - 0.1;

  // Key heights.
  const T = top + TOP_M; // cloth over the crown centre
  const yRing = Math.min(ctx.hat.y + 0.02, top + 0.015); // where the flat crown turns into the sides
  let yFold = bezelTop + 0.015; // forehead fold: just above the face screen
  if (yFold > yRing - 0.005) yFold = Math.max(bezelTop + 0.006, yRing - 0.005);
  const agalLow = yFold + 0.032, agalHigh = agalLow + 0.033;

  // Radius of the crown ring and of the cloth hanging down the sides (it drapes over the widest point, then falls straight).
  const ringR = (phi: number) => {
    let r = 0;
    for (let y = yRing; y <= top + 0.001; y += 0.01) r = Math.max(r, crossRadius(headCross(variant, y), phi));
    return r + M;
  };
  const sideR = (y: number, phi: number, ring = ringR(phi)) => {
    let r = ring - M;
    for (let yy = yRing; yy >= y - 1e-6; yy -= 0.008) r = Math.max(r, crossRadius(headCross(variant, yy), phi));
    return Math.max(r, crossRadius(headCross(variant, y), phi)) + M;
  };
  const capY = (r: number, ring: number) => T - (T - yRing) * sq(Math.min(1, r / ring));
  /** Cloth radius at any height (cap curve above the ring, side drape below). */
  const clothR = (y: number, phi: number) => {
    const ring = ringR(phi);
    return y >= yRing ? ring * root((T - y) / Math.max(1e-4, T - yRing)) : sideR(y, phi, ring);
  };
  const at3 = (r: number, y: number, phi: number) => new THREE.Vector3(r * Math.sin(phi), y + lift, r * Math.cos(phi));

  // Face opening: the fold must pass outside the screen bezel at every height it spans.
  let phiF = 0.6;
  for (; phiF < 1.4; phiF += 0.01) {
    let ok = true;
    for (let y = -bezelTop; y <= bezelTop; y += 0.02) {
      const r = sideR(Math.min(y, yFold), phiF);
      if (!(r * Math.sin(phiF) >= bezelW + 0.025 || r * Math.cos(phiF) <= bezelBack - 0.01)) { ok = false; break; }
    }
    if (ok) break;
  }

  // Torso-local → head_top-local.
  const fromTorso = (p: V) => new THREE.Vector3((body.W * p.x) / body.hs, (p.y - ctx.torsoH / 2 - body.gap) / body.hs + bottom + lift, (body.D * p.z) / body.hs);
  const yokeTop = yokeY(sec, outer);
  const shoulder = (phi: number, s: number, extra: number) => fromTorso(garmentPoint(sec, outer, phi, yokeTop, s, extra));
  const trunk = (phi: number, depth: number, extra: number) => fromTorso(garmentPoint(sec, outer, phi, yokeTop - depth, 0, extra));

  /* 1. Crown cap: flat-ish top from the centre out to the ring, then down to the agal (planar UV from above). */
  const COLS = 96;
  const colPhi = (c: number) => -Math.PI + (Math.PI * 2 * c) / COLS;
  const capRows: V[][] = [], capUV: [number, number][][] = [];
  const CAP_K = 8;
  const ringCache = Array.from({ length: COLS + 1 }, (_, c) => ringR(colPhi(c)));
  const capLevels: { k?: number; y?: number }[] = [...Array.from({ length: CAP_K + 1 }, (_, k) => ({ k })), ...(agalLow < yRing ? [0.5, 1].map((f) => ({ y: yRing - (yRing - agalLow) * f })) : [])];
  for (const lv of capLevels) {
    const row: V[] = [], uvr: [number, number][] = [];
    for (let c = 0; c <= COLS; c++) {
      const phi = colPhi(c), ring = ringCache[c];
      let p: V;
      if (lv.k !== undefined) {
        const r = (ring * lv.k) / CAP_K;
        const y = capY(r, ring);
        // Above the agal only; when the agal sits in the cap (round heads), stop the cap at the agal.
        p = y < agalLow ? at3(clothR(agalLow, phi), agalLow, phi) : at3(r, y, phi);
      } else p = at3(sideR(lv.y!, phi, ring), lv.y!, phi);
      row.push(p);
      uvr.push([p.x / TILE, p.z / TILE]);
    }
    capRows.push(row); capUV.push(uvr);
  }
  const cap = gridGeometry(capRows, capUV);

  /* 2. Band from the agal down to the forehead fold, all the way round (cylindrical UV, v = distance from the agal). */
  const u0 = (TILE * Math.round((Math.PI * 2 * 0.4) / TILE)) / (Math.PI * 2); // circumference = whole tiles → seamless at the back
  const bandLevels = Array.from({ length: 7 }, (_, i) => agalLow - ((agalLow - yFold) * i) / 6);
  const bandCols: V[][] = [];
  const bandRows: V[][] = bandLevels.map(() => []), bandUV: [number, number][][] = bandLevels.map(() => []);
  for (let c = 0; c <= COLS; c++) {
    const phi = colPhi(c);
    const col = bandLevels.map((y) => at3(clothR(y, phi), y, phi));
    const acc = cumulative(col);
    col.forEach((p, i) => { bandRows[i].push(p); bandUV[i].push([(phi * u0) / TILE, acc[i] / TILE]); });
    bandCols.push(col);
  }
  const band = gridGeometry(bandRows, bandUV);
  const bandLen = (phi: number) => {
    const p = phi > Math.PI ? phi - Math.PI * 2 : phi; // drape angles run past π; band columns cover [−π, π]
    const col = bandCols[Math.min(COLS, Math.max(0, Math.round(((p + Math.PI) / (Math.PI * 2)) * COLS)))];
    return cumulative(col)[col.length - 1];
  };

  /* 3. Drape: everything but the face opening, from the fold down the head, onto the shoulders and down to the hem. */
  const DCOLS = 88, HEAD_ROWS = 14, FALL_ROWS = 7, BODY_ROWS = 16;
  const torsoDepth = (f: number) => f * ctx.torsoH;
  const sEnd = 0.3; // side hem sits on top of the shoulder, clear of the sleeve caps
  const drapeCols: V[][] = [];
  const drapeUV: [number, number][][] = [];
  for (let c = 0; c <= DCOLS; c++) {
    const psi = phiF + ((Math.PI * 2 - 2 * phiF) * c) / DCOLS; // robot's left front edge → round the back → right front edge
    const delta = Math.min(psi, Math.PI * 2 - psi); // angular distance from the front
    const ring = ringR(psi);
    // head part
    const pts: V[] = [];
    for (let i = 0; i <= HEAD_ROWS; i++) { const y = yFold - ((yFold - bottom) * i) / HEAD_ROWS; pts.push(at3(sideR(y, psi, ring), y, psi)); }
    const hb = pts[pts.length - 1];
    // landing: where the shoulder is right below the head edge (never outside s = sEnd)
    const hbR = Math.hypot(hb.x, hb.z);
    let sLand = sEnd;
    for (let s = 0.9; s >= sEnd; s -= 0.02) { const p = shoulder(psi, s, 0.025); if (Math.hypot(p.x, p.z) >= hbR - 0.01) { sLand = s; break; } }
    const land = shoulder(psi, sLand, 0.025);
    const dy = Math.max(0.02, hb.y - land.y);
    const fall = new THREE.CubicBezierCurve3(hb, hb.clone().add(new THREE.Vector3(0, -dy * 0.45, 0)), land.clone().add(new THREE.Vector3(0, dy * 0.3, 0)), land);
    for (let i = 1; i <= FALL_ROWS; i++) pts.push(fall.getPoint(i / FALL_ROWS));
    // body part: λ ∈ [0,1] runs down the shoulder yoke (s: sLand → 0), then λ-1 is depth below the yoke.
    const lamTip = 1 + torsoDepth(0.42), lamSide = Math.max(0.03, 1 - sEnd / sLand), lamBack = 1 + torsoDepth(0.22);
    const lamEnd = delta <= Math.PI / 2
      ? lamTip + (lamSide - lamTip) * ((delta - phiF) / (Math.PI / 2 - phiF)) // slanted hem → pointed front ends
      : lamSide + (lamBack - lamSide) * ((delta - Math.PI / 2) / (Math.PI / 2)); // → point in the middle of the back
    const chest = ctx.chestVisible ? 0.07 * (1 - THREE.MathUtils.smoothstep(delta, 1.0, 1.4)) : 0;
    for (let i = 1; i <= BODY_ROWS; i++) {
      const lam = (lamEnd * i) / BODY_ROWS;
      pts.push(lam <= 1 ? shoulder(psi, sLand * (1 - lam), 0.025 + chest * lam) : trunk(psi, lam - 1, 0.025 + chest));
    }
    drapeCols.push(pts);
    const acc = cumulative(pts), v0 = bandLen(psi);
    drapeUV.push(acc.map((d) => [(psi * u0) / TILE, (v0 + d) / TILE] as [number, number]));
  }
  const rowsOf = <X,>(cols: X[][]) => cols[0].map((_, r) => cols.map((col) => col[r]));
  const drape = gridGeometry(rowsOf(drapeCols), rowsOf(drapeUV));

  /* 4. Woven border along the hem (front tip → back point → other tip), a hair above the cloth. */
  const BAND = 0.032;
  const hemIn: V[] = [], hemOut: V[] = [];
  for (const col of drapeCols) {
    const acc = cumulative(col), L = acc[acc.length - 1];
    const nudge = (p: V) => { const h = Math.hypot(p.x, p.z) || 1; return p.clone().add(new THREE.Vector3((p.x / h) * 0.003, 0, (p.z / h) * 0.003)); };
    hemIn.push(nudge(at(col, acc, L - BAND))); hemOut.push(nudge(col[col.length - 1]));
  }
  const hemAcc = cumulative(hemOut);
  // v = 0 at the outer edge: the canvas draws the solid selvedge line at its bottom (v ≈ 0).
  const hem = gridGeometry([hemIn, hemOut], [hemIn.map((_, i) => [hemAcc[i] / 0.12, 1] as [number, number]), hemOut.map((_, i) => [hemAcc[i] / 0.12, 0] as [number, number])]);

  /* 5. The fold: right front tip → up the face → across the forehead → down to the left tip (double layer = thicker edge). */
  const leftEdge = drapeCols[0], rightEdge = drapeCols[DCOLS];
  const brow: V[] = [];
  for (let i = 0; i <= 40; i++) { const phi = -phiF + (2 * phiF * i) / 40; brow.push(at3(clothR(yFold, phi), yFold, phi)); }
  const foldPts = resample([...[...rightEdge].reverse(), ...brow.slice(1, -1), ...leftEdge], 220);
  const foldCurve = new THREE.CatmullRomCurve3(foldPts);
  const foldLen = foldCurve.getLength();
  const fold = new THREE.TubeGeometry(foldCurve, 440, 0.0085, 8, false);

  /* 6. Agal: two stacked black rings on the crown + two tasselled cords at the back. */
  const agalRing = (y: number) => new THREE.CatmullRomCurve3(Array.from({ length: 96 }, (_, i) => { const phi = (i / 96) * Math.PI * 2; return at3(clothR(y, phi) + AGAL_R + 0.002, y, phi); }), true);
  const agal = [agalLow, agalHigh].map((y) => new THREE.TubeGeometry(agalRing(y), 192, AGAL_R, 10, true));
  const cordLen = Math.min(0.2, agalLow - bottom - 0.02);
  const cords = [-0.075, 0.075].map((d) => {
    const phi = Math.PI + d;
    const pts = Array.from({ length: 7 }, (_, i) => { const y = agalLow - (cordLen * i) / 6; return at3(clothR(y, phi) + 0.01, y, phi); });
    const curve = new THREE.CatmullRomCurve3(pts);
    const end = pts[pts.length - 1];
    return { tube: new THREE.TubeGeometry(curve, 24, 0.0065, 6, false), end, dir: curve.getTangent(1) };
  });

  return { cap, band, drape, hem, fold, foldLen, agal, cords };
}

export function Shemagh({ ctx, topId, color, shapeFor }: { ctx: WearCtx; topId: string | null; color: string; shapeFor: OuterShapeFor }) {
  const white = color.toUpperCase() === "#FFFFFF";
  const parts = useMemo(() => {
    const { sec, outer } = shapeFor(ctx, topId);
    return buildShemagh(ctx, sec, outer);
  }, [ctx, topId, shapeFor]);
  const cloth = clothMat("body", white);
  const border = clothMat("border", white);
  const pipe = clothMat("pipe", white, [parts.foldLen / TILE, 0.25]);
  const agal = clothMaterial("#0f0f10");
  const up = new THREE.Vector3(0, 1, 0);
  return (
    <group>
      <mesh geometry={parts.cap} material={cloth} castShadow receiveShadow />
      <mesh geometry={parts.band} material={cloth} castShadow receiveShadow />
      <mesh geometry={parts.drape} material={cloth} castShadow receiveShadow />
      <mesh geometry={parts.hem} material={border} receiveShadow />
      <mesh geometry={parts.fold} material={pipe} castShadow />
      {parts.agal.map((g, i) => <mesh key={i} geometry={g} material={agal} castShadow />)}
      {parts.cords.map((c, i) => (
        <group key={`c${i}`}>
          <mesh geometry={c.tube} material={agal} castShadow />
          {/* tassel hangs below the cord end, narrow end up */}
          <mesh material={agal} position={c.end.clone().addScaledVector(c.dir.clone().normalize(), 0.024)} quaternion={new THREE.Quaternion().setFromUnitVectors(up, c.dir.clone().negate().normalize())} castShadow>
            <cylinderGeometry args={[0.011, 0.016, 0.05, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
