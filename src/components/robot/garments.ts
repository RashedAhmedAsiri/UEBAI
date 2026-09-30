"use client";
import * as THREE from "three";

/**
 * Fitted clothing geometry. Every torso variant has a cross-section (a superellipse
 * |x/a|^n + |z/b|^n = 1, optionally tapered by height). Garments are surfaces offset
 * outward from that section, so a coat on a box torso is boxy and on a barrel is round,
 * with sloped shoulders closing in toward the neck.
 *
 * Coordinates are torso-local: y = 0 at the torso centre, θ = 0 points to the front (+z),
 * θ = π/2 to the robot's left (+x). `s` ∈ [0,1] runs over the shoulder yoke (0 = where the
 * shoulders start curving in, 1 = the collar).
 */
export interface Section {
  a: number; // half-width (x)
  b: number; // half-depth (z, front)
  n: number; // superellipse exponent: 2 = ellipse, larger = boxier
  taper?: "oval"; // oval torsos narrow toward top and bottom
  shoulderStart: number; // distance below the torso top where the yoke begins
  shoulderRise: number; // height of the yoke above that
  dome?: number; // height of anything on top of the torso (boiler dome)
}

export const SECTIONS: Record<string, Section> = {
  barrel: { a: 0.4, b: 0.4, n: 2, shoulderStart: 0.05, shoulderRise: 0.1 },
  box: { a: 0.4, b: 0.28, n: 8, shoulderStart: 0.05, shoulderRise: 0.09 },
  oval: { a: 0.46, b: 0.36, n: 2, taper: "oval", shoulderStart: 0.14, shoulderRise: 0.12 },
  radio: { a: 0.42, b: 0.26, n: 4, shoulderStart: 0.1, shoulderRise: 0.1 },
  vending: { a: 0.39, b: 0.29, n: 10, shoulderStart: 0.03, shoulderRise: 0.08 },
  boiler: { a: 0.42, b: 0.42, n: 2, shoulderStart: 0, shoulderRise: 0.2, dome: 0.15 },
};
export const sectionFor = (variant: string) => SECTIONS[variant] ?? SECTIONS.barrel;

export const NECK_R = 0.13;
export const CLOTH = 0.034; // cloth offset from the body (clears rivets, rings and trim)
/** Chest panel footprint (torso-local, centred at y = 0.02·h). */
export const PLATE = { halfW: 0.2, halfH: 0.15, protrude: 0.055 };

/** Space between torso top and head bottom so collars, domes and scarves never touch the head. */
export function neckGap(sec: Section): number {
  const garmentTop = -sec.shoulderStart + sec.shoulderRise + 0.035; // collar band / scarf above the yoke
  return Math.max(0.12, garmentTop + 0.08, (sec.dome ?? 0) + 0.06);
}

/** Radius of the torso section in direction θ (θ=0 → front/+z, θ=π/2 → +x). */
export function sectionRadius(s: Section, theta: number): number {
  const sx = Math.abs(Math.sin(theta)) / s.a, cz = Math.abs(Math.cos(theta)) / s.b;
  return 1 / Math.pow(Math.pow(sx, s.n) + Math.pow(cz, s.n), 1 / s.n);
}

/** Height taper of the *body* (oval torsos). y torso-local, h = torso height. */
export function taper(s: Section, y: number, h: number): number {
  if (s.taper !== "oval") return 1;
  const t = Math.min(1, Math.abs(y) / (h / 2));
  return Math.max(0.55, Math.sqrt(Math.max(0, 1 - t * t)));
}
/** Cloth drapes: it follows the body above the widest point and hangs straight below it. */
const clothTaper = (s: Section, y: number, h: number) => (y < 0 ? 1 : taper(s, y, h));

export interface GarmentShape {
  h: number; // torso height
  drop: number; // how far the hem hangs below the torso
  flare: number; // extra radius at the hem (0.1 = 10%)
  offset?: number; // extra distance from the body (layers on top of each other)
  /** Front opening half-angle (radians) at height y / yoke param s; 0 = closed. */
  gap?: (y: number, s: number) => number;
  /** Restrict to a θ window instead of wrapping around (pockets, lapels, plackets, capes). */
  window?: (y: number, s: number) => [number, number] | null;
  /** Body-row height range to build (pockets, patches). Defaults to hem → yoke start. */
  yRange?: [number, number];
  /** Yoke range to build; null = no yoke rows. Defaults to [0, 1] when the body reaches the yoke. */
  sRange?: [number, number] | null;
}

export const hemY = (g: GarmentShape) => -g.h / 2 - g.drop;
export const yokeY = (sec: Section, g: GarmentShape) => g.h / 2 - sec.shoulderStart;

/** Normalised height 0 (hem) … 1 (yoke start) … 1.4 (collar) — handy for styling curves. */
export function heightU(sec: Section, g: GarmentShape, y: number, s: number) {
  const b = hemY(g), t = yokeY(sec, g);
  return s > 0 ? 1 + 0.4 * s : Math.max(0, Math.min(1, (y - b) / (t - b)));
}

/** Position on the garment surface. */
export function garmentPoint(sec: Section, g: GarmentShape, theta: number, y: number, s: number, extra = 0): THREE.Vector3 {
  const torsoBottom = -g.h / 2;
  const hemT = y < torsoBottom ? (torsoBottom - y) / Math.max(0.001, g.drop) : 0; // 0 at torso bottom → 1 at hem
  const body = sectionRadius(sec, theta) * clothTaper(sec, Math.max(y, torsoBottom), g.h) + CLOTH + (g.offset ?? 0) + extra;
  let R = body * (1 + g.flare * Math.pow(Math.max(0, hemT), 1.3));
  let yy = y;
  if (s > 0) {
    const top = yokeY(sec, g);
    R = NECK_R + (g.offset ?? 0) + extra + (body - NECK_R) * Math.cos((s * Math.PI) / 2);
    yy = top + (sec.shoulderRise + (g.offset ?? 0) * 0.6 + extra * 0.6) * Math.sin((s * Math.PI) / 2);
  }
  return new THREE.Vector3(R * Math.sin(theta), yy, R * Math.cos(theta));
}

interface Row { y: number; s: number }

function buildRows(sec: Section, g: GarmentShape): Row[] {
  const out: Row[] = [];
  const top = yokeY(sec, g);
  const [y0, y1] = g.yRange ?? [hemY(g), top];
  const yEnd = Math.min(y1, top);
  const bodyRows = g.yRange ? 6 : 24;
  if (yEnd > y0) for (let i = 0; i <= bodyRows; i++) out.push({ y: y0 + ((yEnd - y0) * i) / bodyRows, s: 0 });
  const sRange = g.sRange === undefined ? (y1 >= top - 1e-6 ? [0, 1] : null) : g.sRange;
  if (sRange) {
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const s = sRange[0] + ((sRange[1] - sRange[0]) * i) / n;
      if (s <= 0 && out.length) continue; // body already ends at s = 0
      out.push({ y: top, s: Math.max(1e-4, s) });
    }
  }
  return out;
}

/** Build a garment surface (double-sided) from the torso section. */
export function garmentGeometry(sec: Section, g: GarmentShape, cols = 80): THREE.BufferGeometry {
  const rs = buildRows(sec, g).filter((r) => {
    if (!g.window) return true;
    return g.window(r.y, r.s) !== null;
  });
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  rs.forEach((r, ri) => {
    let t0 = 0, t1 = Math.PI * 2;
    const gap = g.gap?.(r.y, r.s) ?? 0;
    if (gap > 0) { t0 = gap; t1 = Math.PI * 2 - gap; }
    const win = g.window?.(r.y, r.s);
    if (win) { t0 = win[0]; t1 = win[1]; }
    for (let c = 0; c <= cols; c++) {
      const th = t0 + ((t1 - t0) * c) / cols;
      const p = garmentPoint(sec, g, th, r.y, r.s);
      pos.push(p.x, p.y, p.z);
      uv.push((th / (Math.PI * 2)) * 6, p.y * 6);
    }
    if (ri > 0) {
      const a = (ri - 1) * (cols + 1), b = ri * (cols + 1);
      for (let c = 0; c < cols; c++) idx.push(a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Piping along the hem and (for open garments) up both front edges — gives cloth visible thickness. */
export function edgePiping(sec: Section, g: GarmentShape, radius = 0.013): THREE.BufferGeometry {
  const rows = buildRows(sec, { ...g, yRange: undefined, sRange: undefined, window: undefined });
  const gapAt = (r: Row) => g.gap?.(r.y, r.s) ?? 0;
  const hem = rows[0];
  const g0 = gapAt(hem);
  const pts: THREE.Vector3[] = [];
  if (g0 > 0) {
    for (let i = rows.length - 1; i >= 0; i--) pts.push(garmentPoint(sec, g, Math.PI * 2 - gapAt(rows[i]), rows[i].y, rows[i].s, 0.003));
    for (let c = 1; c < 60; c++) pts.push(garmentPoint(sec, g, Math.PI * 2 - g0 - ((Math.PI * 2 - 2 * g0) * c) / 60, hem.y, 0, 0.003));
    for (let i = 0; i < rows.length; i++) pts.push(garmentPoint(sec, g, gapAt(rows[i]), rows[i].y, rows[i].s, 0.003));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, radius, 6, false);
  }
  for (let c = 0; c < 72; c++) pts.push(garmentPoint(sec, g, (Math.PI * 2 * c) / 72, hem.y, 0, 0.003));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 216, radius, 6, true);
}

/** Ring around the garment at a given height / yoke position (collar band, scarf, belt, stripes). */
export function ringAt(sec: Section, g: GarmentShape, y: number, s: number, radius: number, extra = 0.006, arc?: [number, number]): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const [a0, a1] = arc ?? [0, Math.PI * 2];
  const closed = !arc;
  const n = 72;
  for (let c = 0; c < (closed ? n : n + 1); c++) pts.push(garmentPoint(sec, g, a0 + ((a1 - a0) * c) / n, y, s, extra));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), n * 3, radius, 8, closed);
}

/** Height of a stand-up collar above the top of the yoke (stays inside neckGap's collar allowance + margin). */
export const STAND_H = 0.042;

/** Stand-up collar: a band rising straight from the neckline, tapering in slightly like stiffened cloth. */
export function standCollarGeometry(sec: Section, g: GarmentShape, height = STAND_H, cols = 72): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let c = 0; c <= cols; c++) {
    const th = (Math.PI * 2 * c) / cols;
    const p = garmentPoint(sec, g, th, yokeY(sec, g), 1, 0.004);
    const r = Math.hypot(p.x, p.z), k = (r - 0.006) / r;
    pos.push(p.x, p.y, p.z, p.x * k, p.y + height, p.z * k);
    uv.push(c / cols * 6, 0, c / cols * 6, 1);
    if (c < cols) { const a = c * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Rolled top edge of a stand-up collar. */
export function standCollarEdge(sec: Section, g: GarmentShape, height = STAND_H, radius = 0.0055): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let c = 0; c < 72; c++) {
    const p = garmentPoint(sec, g, (Math.PI * 2 * c) / 72, yokeY(sec, g), 1, 0.004);
    const r = Math.hypot(p.x, p.z), k = (r - 0.006) / r;
    pts.push(new THREE.Vector3(p.x * k, p.y + height, p.z * k));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 216, radius, 8, true);
}

/** Tube that follows the garment surface through (θ, y, s) waypoints — straps, cords, lanyards. */
export function surfaceTube(sec: Section, g: GarmentShape, way: [number, number, number][], radius: number, extra = 0.015, flat = false): THREE.BufferGeometry {
  const pts = way.map(([th, y, s]) => garmentPoint(sec, g, th, y, s, extra));
  const curve = new THREE.CatmullRomCurve3(pts);
  if (!flat) return new THREE.TubeGeometry(curve, 64, radius, 8, false);
  // Flat strap: a thin ribbon extruded along the curve.
  const shape = new THREE.Shape();
  shape.moveTo(-radius, -0.006); shape.lineTo(radius, -0.006); shape.lineTo(radius, 0.006); shape.lineTo(-radius, 0.006); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { steps: 64, extrudePath: curve, bevelEnabled: false });
}

/**
 * Smallest opening half-angle that keeps a coat's front edges outside the chest panel,
 * so an open coat never slices through the dashboard.
 */
export function plateClearAngle(sec: Section, g: GarmentShape): number {
  for (let th = 0.05; th < 1.4; th += 0.01) {
    const p = garmentPoint(sec, { ...g, gap: undefined }, th, 0.02 * g.h, 0);
    if (Math.abs(p.x) >= PLATE.halfW + 0.035) return th;
  }
  return 1.4;
}

/** Sleeve: tapered open tube hanging from the shoulder pivot along −y, with soft folds. */
export function sleeveGeometry(length: number, rTop = 0.118, rBottom = 0.095): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = rTop + (rBottom - rTop) * t + Math.sin(t * Math.PI * 6) * 0.0035 * (0.3 + t);
    pts.push(new THREE.Vector2(r, -t * length));
  }
  return new THREE.LatheGeometry(pts, 32);
}
