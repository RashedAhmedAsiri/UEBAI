"use client";
import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { clothMaterial, robotMaterial, solidMaterial } from "./materials";
import { helix, symbolTexture } from "./geometry";
import {
  CLOTH, PLATE, STAND_H, edgePiping, garmentGeometry, garmentPoint, heightU, plateClearAngle, ringAt, sectionFor, sectionRadius, sleeveGeometry,
  standCollarEdge, standCollarGeometry, surfaceTube, yokeY, type GarmentShape, type Section,
} from "./garments";
import { ITEM_BY_ID, type Item } from "@/lib/catalog";
import { Shemagh, type OuterShapeFor } from "./shemagh";

const chrome = () => robotMaterial("polished_chrome");
const brass = () => robotMaterial("brass");
const wood = () => robotMaterial("wood_panel");
const plastic = (c: string) => robotMaterial("toy_plastic", c);
const glass = () => solidMaterial("#d8f3ff", { rough: 0.05, transparent: 0.3 });
const paper = () => solidMaterial("#f4ecd6", { rough: 0.9 });
const black = () => solidMaterial("#15171a", { rough: 0.4 });
const shade = (hex: string, f: number) => "#" + new THREE.Color(hex).multiplyScalar(f).getHexString();

export interface WearCtx {
  torsoH: number;
  torsoVariant: string;
  /** Chest dashboard is showing (not covered by a closed top or shirt). */
  chestVisible: boolean;
  headW: number;
  headH: number;
  headD: number;
  headTop: number;
  headBottom: number;
  headFront: number;
  screen: [number, number];
  /** Where a hat sits: crown radii at that height, height (head-local) and front/back centre. */
  hat: { rx: number; rz: number; y: number; cz: number };
  /** Top of the ears (head-local y) and how far they stick out beyond the head side. */
  earTop: number;
  earOut: number;
  /** Head model id (drapes like the shemagh fit its exact shape). */
  headVariant?: string;
  /** Body layout for items that span head and shoulders: head scale, neck gap, torso width/depth scale. */
  body?: { hs: number; gap: number; W: number; D: number };
}

/* =====================================================================
   TOPS — fitted garments built from the torso's cross-section
   ===================================================================== */
type Opening = "coat" | "vneck" | "closed" | "narrow";
export interface TopStyle {
  color: string;
  drop: number;
  flare: number;
  opening: Opening;
  sleeve: "long" | "short" | "none";
  lapel?: string;
  shirt?: string;
  pockets?: "coat" | "chest" | "kangaroo" | "cargo" | "welt";
  buttons?: number;
  /** Button colour (defaults: plastic on a lab coat, brass otherwise). */
  buttonColor?: string;
  collar?: "band" | "coat" | "hood" | "stand";
  zipper?: boolean;
  stripes?: string;
  elbowPatches?: string;
  placket?: boolean;
  studs?: boolean;
  /** Hidden side-seam pocket openings at the hips. */
  sideSlits?: boolean;
  cuff?: "plain" | "rib" | "wide" | "french";
}

const STYLES: Record<string, TopStyle> = {
  lab_coat: { color: "#F4F5F0", drop: 0.34, flare: 0.1, opening: "coat", sleeve: "long", lapel: "#E6E8E1", pockets: "coat", buttons: 3, collar: "coat", cuff: "plain" },
  tweed_jacket: { color: "#8A6A45", drop: 0.12, flare: 0.05, opening: "coat", sleeve: "long", lapel: "#6F5436", shirt: "#CFE2F3", pockets: "coat", buttons: 2, collar: "coat", elbowPatches: "#4E3320", cuff: "plain" },
  tuxedo: { color: "#1E1E24", drop: 0.16, flare: 0.05, opening: "coat", sleeve: "long", lapel: "#0B0B0E", shirt: "#FFFFFF", buttons: 1, collar: "coat", studs: true, cuff: "plain" },
  hoodie: { color: "#3A4A63", drop: 0.06, flare: 0.02, opening: "closed", sleeve: "long", pockets: "kangaroo", collar: "hood", cuff: "rib" },
  scrubs: { color: "#4FB3A5", drop: 0.08, flare: 0.03, opening: "vneck", sleeve: "short", pockets: "chest", cuff: "plain" },
  tracksuit: { color: "#D63A3A", drop: 0.04, flare: 0, opening: "closed", sleeve: "long", zipper: true, collar: "band", stripes: "#FFFFFF", cuff: "rib" },
  // Saudi thobe: ankle length (hem ~0.12 above the floor, since the torso starts at BASE_HEIGHT 0.5), nearly straight fall,
  // stiff stand collar, short front placket with small white buttons, welt breast pocket on the wearer's left,
  // side-seam pockets, and straight sleeves ending in cufflink cuffs.
  thobe_coat: { color: "#FAFAF7", drop: 0.38, flare: 0.06, opening: "closed", sleeve: "long", collar: "stand", placket: true, buttons: 3, buttonColor: "#F2F2EE", pockets: "welt", sideSlits: true, cuff: "french" },
  explorer_vest: { color: "#B59B6A", drop: 0.06, flare: 0.02, opening: "narrow", sleeve: "none", pockets: "cargo", collar: "coat" },
};
export const topStyle = (id: string | null | undefined): TopStyle | null => (id ? STYLES[id] ?? null : null);

/** Does this top leave the chest dashboard visible? */
export const showsChest = (style: TopStyle | null) => !style || ((style.opening === "coat" || style.opening === "narrow") && !style.shirt);

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function garmentShapeFor(ctx: Pick<WearCtx, "torsoH" | "torsoVariant" | "chestVisible">, style: TopStyle | null): { sec: Section; shape: GarmentShape } {
  const sec = sectionFor(ctx.torsoVariant);
  if (!style) return { sec, shape: { h: ctx.torsoH, drop: 0, flare: 0, offset: -CLOTH + 0.006 } };
  const shape: GarmentShape = { h: ctx.torsoH, drop: style.drop, flare: style.flare };
  const u = (y: number, s: number) => heightU(sec, shape, y, s);
  let base: ((y: number, s: number) => number) | undefined;
  switch (style.opening) {
    case "coat": base = (y, s) => { const v = u(y, s); return v < 0.62 ? 0.2 : 0.2 + ((v - 0.62) / 0.78) * 1.0; }; break;
    case "narrow": base = (y, s) => 0.34 + u(y, s) * 0.34; break;
    case "vneck": base = (y, s) => { const v = u(y, s); return v < 0.8 ? 0 : ((v - 0.8) / 0.6) * 0.8; }; break;
  }
  if (base && ctx.chestVisible && (style.opening === "coat" || style.opening === "narrow")) {
    // Keep the front edges outside the chest dashboard at the heights where it sits.
    const clear = plateClearAngle(sec, shape);
    const py = 0.02 * ctx.torsoH, lo = py - PLATE.halfH - 0.06, hi = py + PLATE.halfH + 0.06;
    const inner = base;
    base = (y, s) => {
      const w = s > 0 ? 1 : smoothstep(lo - 0.08, lo, y) * (1 - smoothstep(hi, hi + 0.08, y));
      return Math.max(inner(y, s), clear * w);
    };
  }
  shape.gap = base;
  return { sec, shape };
}

function Mesh({ geo, mat }: { geo: THREE.BufferGeometry; mat: THREE.Material }) {
  return <mesh geometry={geo} material={mat} castShadow receiveShadow />;
}

function TopGarment({ style, ctx }: { style: TopStyle; ctx: WearCtx }) {
  // Memo on primitives: the robot re-renders often (streaming chat); geometry must not be rebuilt each time.
  const { sec, shape } = useMemo(() => garmentShapeFor(ctx, style), [ctx.torsoVariant, ctx.torsoH, ctx.chestVisible, style]); // eslint-disable-line react-hooks/exhaustive-deps
  const u = (y: number, s: number) => heightU(sec, shape, y, s);
  const hem = -shape.h / 2 - shape.drop, top = yokeY(sec, shape);
  const yAt = (v: number) => hem + (top - hem) * v;

  const parts = useMemo(() => {
    const out: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    const cloth = clothMaterial(style.color);
    out.push({ geo: garmentGeometry(sec, shape), mat: cloth });
    out.push({ geo: edgePiping(sec, shape, 0.013), mat: clothMaterial(shade(style.color, 0.86)) });
    const gap = shape.gap;
    // Shirt under an open jacket
    if (style.shirt && gap) {
      out.push({
        geo: garmentGeometry(sec, { ...shape, drop: 0, flare: 0, offset: -0.016, gap: undefined, window: (y, s) => { const g = gap(y, s) + 0.1; return [-g, g]; }, yRange: [yAt(0.3), top] }, 28),
        mat: clothMaterial(style.shirt),
      });
    }
    // Lapels folded back on both sides of the opening
    if (style.lapel && gap) {
      const w = (y: number, s: number) => { const v = u(y, s); return v < 0.6 ? 0 : v < 0.95 ? ((v - 0.6) / 0.35) * 0.34 : Math.max(0.1, 0.34 - ((v - 0.95) / 0.45) * 0.24); };
      const lapelMat = style.lapel === "#0B0B0E" ? solidMaterial("#0B0B0E", { metal: 0.2, rough: 0.2 }) : clothMaterial(style.lapel);
      const win = (side: 1 | -1) => (y: number, s: number) => {
        const ww = w(y, s); if (ww < 0.002) return null;
        const g = gap(y, s);
        return side > 0 ? [g, g + ww] as [number, number] : [-g - ww, -g] as [number, number];
      };
      out.push({ geo: garmentGeometry(sec, { ...shape, offset: 0.008, window: win(1), yRange: [yAt(0.6), top], sRange: [0, 0.92] }, 10), mat: lapelMat });
      out.push({ geo: garmentGeometry(sec, { ...shape, offset: 0.008, window: win(-1), yRange: [yAt(0.6), top], sRange: [0, 0.92] }, 10), mat: lapelMat });
    }
    // Collar
    if (style.collar === "coat") {
      out.push({ geo: garmentGeometry(sec, { ...shape, offset: 0.014, window: (y, s) => { const g = (gap?.(y, s) ?? 0.45) + 0.28; return [g, Math.PI * 2 - g]; }, yRange: [top, top], sRange: [0.55, 1] }, 44), mat: clothMaterial(shade(style.color, 0.94)) });
    }
    if (style.collar === "band") out.push({ geo: ringAt(sec, shape, top, 1, 0.026, 0.012), mat: clothMaterial(shade(style.color, 0.9)) });
    if (style.collar === "stand") {
      // Stiff stand-up collar (Saudi "royal" collar) with a rolled top edge.
      out.push({ geo: standCollarGeometry(sec, shape, STAND_H), mat: clothMaterial(shade(style.color, 0.975)) });
      out.push({ geo: standCollarEdge(sec, shape, STAND_H, 0.0055), mat: clothMaterial(shade(style.color, 0.92)) });
    }
    // Pockets (patches a hair above the cloth, with a top welt)
    const patch = (t0: number, t1: number, v0: number, v1: number, color = shade(style.color, 0.95)) => {
      out.push({ geo: garmentGeometry(sec, { ...shape, offset: 0.006, window: () => [t0, t1], yRange: [yAt(v0), yAt(v1)], sRange: null }, 8), mat: clothMaterial(color) });
      out.push({ geo: ringAt(sec, shape, yAt(v1), 0, 0.006, 0.011, [t0, t1]), mat: clothMaterial(shade(style.color, 0.8)) });
    };
    if (style.pockets === "coat") { patch(0.62, 1.1, 0.14, 0.3); patch(-1.1, -0.62, 0.14, 0.3); patch(-1.0, -0.66, 0.62, 0.74); }
    if (style.pockets === "chest") patch(0.4, 0.78, 0.66, 0.78);
    if (style.pockets === "kangaroo") patch(-0.6, 0.6, 0.18, 0.42, shade(style.color, 0.9));
    if (style.pockets === "cargo") { patch(0.72, 1.12, 0.16, 0.32); patch(-1.12, -0.72, 0.16, 0.32); patch(0.74, 1.08, 0.52, 0.66); patch(-1.08, -0.74, 0.52, 0.66); }
    if (style.pockets === "welt") {
      // Welt breast pocket on the wearer's left (+x): only the stitched opening shows.
      out.push({ geo: garmentGeometry(sec, { ...shape, offset: 0.004, window: () => [0.4, 0.74], yRange: [yAt(0.845), yAt(0.862)], sRange: null }, 8), mat: clothMaterial(shade(style.color, 0.95)) });
      out.push({ geo: ringAt(sec, shape, yAt(0.862), 0, 0.0035, 0.006, [0.4, 0.74]), mat: clothMaterial(shade(style.color, 0.84)) });
    }
    if (style.sideSlits) for (const side of [1, -1]) {
      out.push({ geo: surfaceTube(sec, shape, [[side * 1.52, yAt(0.36), 0], [side * 1.52, yAt(0.47), 0]], 0.0035, 0.004), mat: clothMaterial(shade(style.color, 0.84)) });
    }
    if (style.placket) {
      // A thobe's placket is short and narrow and runs up into the collar; a coat's is wider and stops at the yoke.
      const thobe = style.collar === "stand";
      out.push({ geo: garmentGeometry(sec, { ...shape, offset: 0.005, window: () => (thobe ? [-0.045, 0.045] : [-0.07, 0.07]), yRange: [yAt(thobe ? 0.78 : 0.62), top], sRange: [0, thobe ? 1 : 0.6] }, 4), mat: clothMaterial(shade(style.color, thobe ? 0.96 : 0.93)) });
    }
    if (style.zipper) out.push({ geo: surfaceTube(sec, shape, [[0, hem, 0], [0, yAt(0.5), 0], [0, top, 0], [0, top, 0.99]], 0.009, 0.007), mat: chrome() });
    if (style.stripes) for (const side of [1, -1]) out.push({ geo: surfaceTube(sec, shape, [[side * 1.45, hem + 0.02, 0], [side * 1.5, yAt(0.5), 0], [side * 1.55, top, 0], [side * 1.57, top, 0.7]], 0.012, 0.006), mat: clothMaterial(style.stripes) });
    return out;
  }, [sec, shape, style]); // eslint-disable-line react-hooks/exhaustive-deps

  // Small hard parts: buttons, studs, pen, hood, drawstrings.
  const extras: ReactNode[] = [];
  if (style.buttons) {
    const thobe = style.collar === "stand";
    const buttonMat = style.buttonColor ? solidMaterial(style.buttonColor, { rough: 0.25 }) : style.color === "#F4F5F0" ? plastic("#D9DCD4") : brass();
    for (let i = 0; i < style.buttons; i++) {
      const v = thobe ? 0.81 + i * 0.055 : style.placket ? 0.7 + i * 0.075 : 0.3 + i * 0.12;
      const y = yAt(Math.min(0.98, v));
      const th = style.placket ? 0 : (shape.gap?.(y, 0) ?? 0) + 0.1;
      extras.push(<mesh key={`b${i}`} position={garmentPoint(sec, shape, th, y, 0, 0.012)} rotation={[0, th, 0]} scale={[1, 1, 0.45]} material={buttonMat} castShadow><sphereGeometry args={[thobe ? 0.013 : 0.021, 14, 10]} /></mesh>);
    }
    // The stand collar closes with one small button at the front.
    if (thobe) {
      const p = garmentPoint(sec, shape, 0, top, 1, 0.009);
      extras.push(<mesh key="collarBtn" position={[p.x, p.y + STAND_H * 0.5, p.z]} scale={[1, 1, 0.45]} material={buttonMat} castShadow><sphereGeometry args={[0.012, 14, 10]} /></mesh>);
    }
  }
  if (style.studs) for (let i = 0; i < 3; i++) extras.push(<mesh key={`s${i}`} position={garmentPoint(sec, { ...shape, offset: -0.016 }, 0, yAt(0.55 + i * 0.1), 0, 0.01)} material={black()}><sphereGeometry args={[0.012, 8, 6]} /></mesh>);
  if (style.pockets === "coat" && style.color === "#F4F5F0") {
    extras.push(<group key="pen" position={garmentPoint(sec, shape, -0.82, yAt(0.76), 0, 0.02)} rotation={[0, -0.82, 0]}>
      <mesh material={plastic("#2B5C8A")}><cylinderGeometry args={[0.01, 0.01, 0.1, 10]} /></mesh>
      <mesh material={chrome()} position={[0.012, 0.03, 0.004]}><boxGeometry args={[0.004, 0.05, 0.004]} /></mesh>
    </group>);
  }
  if (style.collar === "hood") {
    const back = garmentPoint(sec, shape, Math.PI, top, 0.4, 0);
    extras.push(<mesh key="hood" material={clothMaterial(style.color)} position={[0, back.y + 0.02, back.z - 0.13]} rotation={[-1.25, 0, 0]} scale={[1.3, 0.95, 0.7]} castShadow>
      <sphereGeometry args={[0.2, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
    </mesh>);
    for (const th of [-0.09, 0.09]) {
      const p = garmentPoint(sec, shape, th, top, 0.55, 0.012);
      extras.push(<group key={`ds${th}`} position={p}>
        <mesh material={clothMaterial("#F4F1E8")} position={[0, -0.1, 0.004]}><cylinderGeometry args={[0.006, 0.006, 0.2, 6]} /></mesh>
        <mesh material={plastic("#F4F1E8")} position={[0, -0.21, 0.004]}><cylinderGeometry args={[0.01, 0.008, 0.03, 8]} /></mesh>
      </group>);
    }
  }
  if (style.zipper) extras.push(<mesh key="zip" position={garmentPoint(sec, shape, 0, top, 0.85, 0.02)} material={chrome()}><boxGeometry args={[0.025, 0.045, 0.008]} /></mesh>);
  return <group>{parts.map((p, i) => <Mesh key={i} geo={p.geo} mat={p.mat} />)}{extras}</group>;
}

/** Sleeve rendered inside each arm group, so it moves with the arm. */
export function Sleeve({ style, armLength }: { style: TopStyle; armLength: number }) {
  const length = style.sleeve === "short" ? armLength * 0.36 : armLength * 0.86;
  const wide = style.cuff === "wide";
  const rBottom = wide ? 0.13 : 0.094;
  const geo = useMemo(() => sleeveGeometry(length, 0.118, rBottom), [length, rBottom]);
  if (style.sleeve === "none") return null;
  const cloth = clothMaterial(style.color);
  const edge = clothMaterial(shade(style.color, 0.86));
  return (
    <group>
      <mesh material={cloth} scale={[1, 0.8, 1]} castShadow><sphereGeometry args={[0.124, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      <mesh geometry={geo} material={cloth} castShadow receiveShadow />
      <mesh material={edge} position={[0, -length, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[rBottom, 0.013, 8, 32]} /></mesh>
      {style.cuff === "rib" && <mesh material={edge} position={[0, -length + 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[rBottom + 0.002, 0.011, 8, 32]} /></mesh>}
      {style.cuff === "french" && <>
        {/* double cuff band, closed by a silver cufflink on the back of the wrist */}
        <mesh material={clothMaterial(shade(style.color, 0.975))} position={[0, -length + 0.03, 0]}><cylinderGeometry args={[rBottom + 0.006, rBottom + 0.006, 0.06, 32, 1, true]} /></mesh>
        <mesh material={edge} position={[0, -length + 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[rBottom + 0.006, 0.005, 6, 32]} /></mesh>
        <mesh material={solidMaterial("#C9CCD1", { metal: 0.9, rough: 0.25 })} position={[0, -length + 0.03, -(rBottom + 0.011)]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.013, 0.013, 0.006, 16]} /></mesh>
      </>}
      {style.stripes && [0.35, -0.35].map((a) => (
        <mesh key={a} material={clothMaterial(style.stripes!)} position={[Math.sin(Math.PI / 2 + a) * 0.109, -length / 2, Math.cos(Math.PI / 2 + a) * 0.109]} rotation={[0, Math.PI / 2 + a, 0]}>
          <boxGeometry args={[0.018, length * 0.95, 0.005]} />
        </mesh>
      ))}
      {style.elbowPatches && (
        <mesh material={clothMaterial(style.elbowPatches)} position={[0, -length * 0.55, -0.104]} scale={[1, 1.4, 0.25]}><sphereGeometry args={[0.05, 16, 10]} /></mesh>
      )}
    </group>
  );
}

/* =====================================================================
   NECKWEAR — ties sit on the shirt/body; drapes lie over the outer garment
   ===================================================================== */
interface Anchor { sec: Section; inner: GarmentShape; outer: GarmentShape; y: number; front: THREE.Vector3; tilt: number }

function neckAnchor(ctx: WearCtx, topId: string | null): Anchor {
  const style = topStyle(topId);
  const { sec, shape } = garmentShapeFor(ctx, style);
  const outer: GarmentShape = { ...shape, gap: undefined, window: undefined };
  const inner: GarmentShape = !style ? outer
    : style.opening === "coat" ? { ...shape, gap: undefined, offset: style.shirt ? -0.016 : -CLOTH + 0.006 }
    : outer;
  const y = yokeY(sec, shape) - 0.03;
  const front = garmentPoint(sec, inner, 0, y, 0, 0.012);
  // A tie hanging over a visible dashboard leans forward just enough to clear it.
  let tilt = 0;
  if (ctx.chestVisible) {
    const plateTop = 0.02 * ctx.torsoH + PLATE.halfH;
    const plateFront = sectionRadius(sec, 0) + PLATE.protrude + 0.018;
    const depth = y - plateTop;
    const need = plateFront - front.z;
    if (need > 0 && depth > 0.01) tilt = -Math.atan2(need, depth);
  }
  return { sec, inner, outer, y, front, tilt };
}

function useAnchor(ctx: WearCtx, topId: string | null) {
  return useMemo(() => neckAnchor(ctx, topId), [ctx.torsoVariant, ctx.torsoH, ctx.chestVisible, topId]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Bowtie({ color, anchor }: { color: string; anchor: Anchor }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.03, 0.05, 0.1, 0.07, 0.12, 0.045);
    s.bezierCurveTo(0.135, 0.015, 0.135, -0.015, 0.12, -0.045);
    s.bezierCurveTo(0.1, -0.07, 0.03, -0.05, 0, 0);
    return new THREE.ExtrudeGeometry(s, { depth: 0.026, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 4, curveSegments: 16 });
  }, []);
  const m = solidMaterial(color, { rough: 0.45 });
  return <group position={[anchor.front.x, anchor.front.y, anchor.front.z + 0.02]}>
    <mesh geometry={geo} material={m} position={[0.01, 0, -0.013]} castShadow />
    <mesh geometry={geo} material={m} position={[-0.01, 0, 0.013]} rotation={[0, Math.PI, 0]} castShadow />
    <RoundedBox args={[0.045, 0.055, 0.045]} radius={0.015} smoothness={3} material={m} />
  </group>;
}

function Tie({ color, anchor, periodic }: { color: string; anchor: Anchor; periodic?: boolean }) {
  const { knot, blade } = useMemo(() => {
    const k = new THREE.Shape();
    k.moveTo(-0.035, 0.03); k.lineTo(0.035, 0.03); k.lineTo(0.022, -0.03); k.lineTo(-0.022, -0.03); k.closePath();
    const b = new THREE.Shape();
    b.moveTo(-0.02, 0); b.lineTo(0.02, 0); b.lineTo(0.055, -0.26); b.lineTo(0, -0.31); b.lineTo(-0.055, -0.26); b.closePath();
    const opts = { depth: 0.01, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 2 };
    return { knot: new THREE.ExtrudeGeometry(k, { ...opts, depth: 0.028 }), blade: new THREE.ExtrudeGeometry(b, opts) };
  }, []);
  const m = solidMaterial(color, { rough: 0.4 });
  return <group position={anchor.front}>
    <mesh geometry={knot} material={m} position={[0, 0, -0.008]} castShadow />
    <group position={[0, -0.03, 0]} rotation={[anchor.tilt, 0, 0]}>
      <mesh geometry={blade} material={m} position={[0, 0, -0.004]} castShadow />
      {periodic && ["H", "He", "Li", "C"].map((sym, i) => (
        <mesh key={sym} position={[(i % 2 ? 0.018 : -0.018), -0.08 - Math.floor(i / 2) * 0.05, 0.012]}>
          <planeGeometry args={[0.032, 0.032]} /><meshStandardMaterial map={symbolTexture(sym, ["#57B846", "#3E7CB1", "#F2B632", "#E8413C"][i], "#fff")} />
        </mesh>
      ))}
    </group>
  </group>;
}

/** Waypoints that drape around the back of the collar and down the chest on both sides. */
function drapeWay(a: Anchor, endY: number, spread: number): [number, number, number][] {
  const top = yokeY(a.sec, a.outer);
  const way: [number, number, number][] = [[spread, endY, 0], [spread * 1.2, (endY + top) / 2, 0], [spread * 1.5, top, 0.3]];
  for (let i = 0; i <= 8; i++) way.push([spread * 2 + ((Math.PI * 2 - spread * 4) * i) / 8, top, 0.62]);
  way.push([-spread * 1.5, top, 0.3], [-spread * 1.2, (endY + top) / 2, 0], [-spread, endY, 0]);
  return way;
}

function Stethoscope({ anchor }: { anchor: Anchor }) {
  const endY = anchor.y - 0.3;
  const geo = useMemo(() => surfaceTube(anchor.sec, anchor.outer, drapeWay(anchor, endY, 0.42), 0.013, 0.026), [anchor, endY]);
  const right = garmentPoint(anchor.sec, anchor.outer, 0.42, endY, 0, 0.03);
  const left = garmentPoint(anchor.sec, anchor.outer, -0.42, endY, 0, 0.03);
  return <group>
    <mesh geometry={geo} material={black()} castShadow />
    <group position={right} rotation={[Math.PI / 2, 0.42, 0]}>
      <mesh material={chrome()}><cylinderGeometry args={[0.045, 0.045, 0.025, 28]} /></mesh>
      <mesh material={black()} position={[0, 0.014, 0]}><cylinderGeometry args={[0.038, 0.038, 0.006, 28]} /></mesh>
    </group>
    <mesh material={chrome()} position={left}><sphereGeometry args={[0.02, 12, 10]} /></mesh>
  </group>;
}

function Whistle({ color, anchor }: { color: string; anchor: Anchor }) {
  const endY = anchor.y - 0.28;
  const geo = useMemo(() => surfaceTube(anchor.sec, anchor.outer, [...drapeWay(anchor, endY + 0.02, 0.22), [0, endY, 0]], 0.006, 0.02), [anchor, endY]);
  const p = garmentPoint(anchor.sec, anchor.outer, 0, endY - 0.02, 0, 0.045);
  return <group>
    <mesh geometry={geo} material={solidMaterial("#d63a3a")} />
    <group position={p} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={robotMaterial("brass", color)} castShadow><cylinderGeometry args={[0.03, 0.03, 0.055, 18]} /></mesh>
      <mesh material={robotMaterial("brass", color)} position={[0, 0.045, -0.012]}><boxGeometry args={[0.03, 0.05, 0.018]} /></mesh>
    </group>
  </group>;
}

function Scarf({ color, anchor }: { color: string; anchor: Anchor }) {
  const { sec, outer } = anchor;
  const top = yokeY(sec, outer);
  const ring = useMemo(() => ringAt(sec, outer, top, 0.72, 0.05, 0.035), [sec, outer, top]);
  const m = clothMaterial(color);
  const stripe = clothMaterial("#F4F1E8");
  const tail = (th: number, rz: number, len: number) => {
    const p = garmentPoint(sec, outer, th, top, 0.2, 0.06);
    return <group position={p} rotation={[0.05, th, rz]}>
      <RoundedBox args={[0.1, len, 0.028]} radius={0.012} smoothness={2} position={[0, -len / 2, 0]} material={m} castShadow />
      {[0.25, 0.55].map((f) => <mesh key={f} material={stripe} position={[0, -len * f, 0.015]}><boxGeometry args={[0.1, 0.02, 0.004]} /></mesh>)}
      {[-0.035, -0.012, 0.012, 0.035].map((fx) => <mesh key={fx} material={m} position={[fx, -len - 0.02, 0]}><cylinderGeometry args={[0.004, 0.004, 0.04, 4]} /></mesh>)}
    </group>;
  };
  return <group><mesh geometry={ring} material={m} castShadow />{tail(0.22, 0.06, 0.32)}{tail(-0.18, -0.1, 0.24)}</group>;
}

function Neck({ kind, color, ctx, topId }: { kind: "bowtie" | "tie" | "periodic" | "stethoscope" | "whistle" | "scarf"; color: string; ctx: WearCtx; topId: string | null }) {
  const anchor = useAnchor(ctx, topId);
  switch (kind) {
    case "bowtie": return <Bowtie color={color} anchor={anchor} />;
    case "tie": return <Tie color={color} anchor={anchor} />;
    case "periodic": return <Tie color={color} anchor={anchor} periodic />;
    case "stethoscope": return <Stethoscope anchor={anchor} />;
    case "whistle": return <Whistle color={color} anchor={anchor} />;
    default: return <Scarf color={color} anchor={anchor} />;
  }
}

/* =====================================================================
   HEADWEAR — lathe-turned hats that sit where the head is as wide as the crown
   (placed in the head_top group: y is relative to the head top)
   ===================================================================== */
const lathe = (pts: [number, number][], seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

function hatFrame(ctx: WearCtx) {
  const { rx, rz, y, cz } = ctx.hat;
  const r = Math.max(rx, rz) + 0.012;
  return { r, sx: (rx + 0.012) / r, sz: (rz + 0.012) / r, pos: [0, y - ctx.headTop, cz] as [number, number, number] };
}

function BrimHat({ color, ctx }: { color: string; ctx: WearCtx }) {
  const { r, sx, sz, pos } = hatFrame(ctx);
  const geo = useMemo(() => lathe([[0, 0.5], [0.3, 0.47], [0.55, 0.52], [0.85, 0.44], [0.96, 0.3], [1, 0.06], [1.02, 0.03], [1.62, 0.02], [1.74, -0.03], [1.7, -0.05], [1.0, -0.005], [0.97, -0.01]]), []);
  const band = useMemo(() => lathe([[1.012, 0.04], [1.018, 0.15], [1.0, 0.16]]), []);
  return <group position={pos} scale={[r * sx, r, r * sz]}>
    <mesh geometry={geo} material={clothMaterial(color)} castShadow receiveShadow />
    <mesh geometry={band} material={clothMaterial(shade(color, 0.55))} />
  </group>;
}

function Tricorn({ color, ctx }: { color: string; ctx: WearCtx }) {
  const { r, sx, sz, pos } = hatFrame(ctx);
  const { brim, trim } = useMemo(() => {
    const segs = 120, rings = 7;
    const P: number[] = [], idx: number[] = [];
    const up = (th: number) => 0.5 - 0.5 * Math.cos(3 * th); // 0 at the three points, 1 between
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j <= segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const uu = up(th);
        const rad = 0.97 + t * (0.72 - 0.26 * uu);
        const y = 0.02 + t * t * 0.55 * uu;
        P.push(rad * Math.sin(th), y, rad * Math.cos(th));
        if (i === rings && j < segs) edge.push(new THREE.Vector3(rad * Math.sin(th), y, rad * Math.cos(th)));
      }
      if (i > 0) for (let j = 0; j < segs; j++) { const a = (i - 1) * (segs + 1) + j, b = i * (segs + 1) + j; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { brim: g, trim: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 240, 0.022, 6, true) };
  }, []);
  const crown = useMemo(() => lathe([[0, 0.42], [0.5, 0.4], [0.85, 0.3], [0.99, 0.08], [1.0, 0]]), []);
  return <group position={pos} scale={[r * sx, r, r * sz]}>
    <mesh geometry={crown} material={clothMaterial(color)} castShadow />
    <mesh geometry={brim} material={clothMaterial(color)} castShadow receiveShadow />
    <mesh geometry={trim} material={robotMaterial("gold")} />
  </group>;
}

function Beret({ color, ctx }: { color: string; ctx: WearCtx }) {
  const { r, pos } = hatFrame(ctx);
  const geo = useMemo(() => lathe([[0, 0.2], [0.55, 0.19], [1.0, 0.14], [1.22, 0.07], [1.2, 0.02], [1.0, 0.0], [0.96, 0.02]]), []);
  return <group position={[pos[0] + 0.03 * r, pos[1] - 0.01, pos[2]]} rotation={[0.06, 0, -0.18]} scale={r}>
    <mesh geometry={geo} material={clothMaterial(color)} castShadow />
    <mesh material={clothMaterial(color)} position={[0, 0.23, 0]}><cylinderGeometry args={[0.02, 0.03, 0.08, 8]} /></mesh>
  </group>;
}

function SpaceHelmet({ ctx }: { ctx: WearCtx }) {
  // Encloses head + ears + face bezel; open at the bottom just under the chin so it never enters the body.
  // Centre on the real head bounds (heads are not all centred on their origin, e.g. the saucer).
  const cy = (ctx.headTop + ctx.headBottom) / 2, half = (ctx.headTop - ctx.headBottom) / 2;
  const R = Math.max(Math.hypot(ctx.headW / 2 + ctx.earOut, half), ctx.headFront + 0.07, Math.hypot(ctx.headD / 2, half)) + 0.05;
  const yb = ctx.headBottom - 0.05 - cy;
  const thetaLen = Math.acos(Math.max(-1, Math.min(1, yb / R)));
  const ringR = Math.sqrt(Math.max(0, R * R - yb * yb));
  return <group position={[0, cy - ctx.headTop, ctx.hat.cz * 0.5]}>
    <mesh material={glass()}><sphereGeometry args={[R, 56, 36, 0, Math.PI * 2, 0, thetaLen]} /></mesh>
    <mesh material={robotMaterial("brushed_steel", "#EDEFF2")} position={[0, yb, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><torusGeometry args={[ringR, 0.045, 16, 48]} /></mesh>
    <mesh material={robotMaterial("gold")} position={[0, R * 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[Math.sqrt(R * R - (R * 0.25) ** 2) + 0.002, 0.01, 6, 56, Math.PI]} /></mesh>
  </group>;
}

function GradCap({ color, ctx }: { color: string; ctx: WearCtx }) {
  const { r, sx, sz, pos } = hatFrame(ctx);
  const cap = useMemo(() => lathe([[0.2, 0.2], [0.95, 0.19], [1.0, 0.05], [0.98, -0.04]]), []);
  const tassel = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.27, 0), new THREE.Vector3(0.7, 0.27, 0.6), new THREE.Vector3(1.05, 0.21, 0.95), new THREE.Vector3(1.08, -0.1, 0.98),
  ]), 24, 0.018, 6), []);
  const m = clothMaterial(color);
  return <group position={pos} scale={[r * sx, r, r * sz]}>
    <mesh geometry={cap} material={m} castShadow />
    <mesh material={m} position={[0, 0.23, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><boxGeometry args={[1.7, 0.06, 1.7]} /></mesh>
    <mesh material={solidMaterial("#F2B632")} position={[0, 0.27, 0]}><sphereGeometry args={[0.06, 12, 10]} /></mesh>
    <mesh geometry={tassel} material={solidMaterial("#F2B632")} />
    <mesh material={solidMaterial("#F2B632")} position={[1.08, -0.2, 0.98]}><cylinderGeometry args={[0.03, 0.07, 0.2, 12]} /></mesh>
  </group>;
}

function Headband({ color, ctx }: { color: string; ctx: WearCtx }) {
  const { rx, rz, cz } = ctx.hat;
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * (rx + 0.022), 0, Math.cos(a) * (rz + 0.022))); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 144, 0.03, 10, true);
  }, [rx, rz]);
  return <group position={[0, ctx.hat.y - ctx.headTop - 0.035, cz]}>
    <mesh geometry={geo} material={clothMaterial(color)} castShadow />
    <mesh material={clothMaterial("#D63A3A")} position={[(rx + 0.05) * 0.7, 0, (rz + 0.05) * 0.7]} rotation={[0, Math.PI / 4, 0]}><boxGeometry args={[0.04, 0.062, 0.01]} /></mesh>
  </group>;
}

/* =====================================================================
   EYEWEAR — lenses sit on the screen eyes; temples rest on top of the ears
   (placed in the face group: z = 0 is the screen bezel front)
   ===================================================================== */
function eyeLayout(ctx: WearCtx) {
  const [sw, sh] = ctx.screen;
  return { ex: 0.203 * sw, ey: 0.08 * sh, r: Math.min(0.135 * sw, 0.24 * sh) };
}
/** Temple arms: from the lens edge back along the head side, over the ear, hooking down behind it. */
function templeCurves(ctx: WearCtx, ex: number, r: number, ey: number) {
  const side = ctx.headW / 2 + 0.018;
  const restY = ctx.earOut > 0 ? ctx.earTop + 0.012 : ey;
  const restX = side + (ctx.earOut > 0 ? Math.min(ctx.earOut, 0.06) : 0);
  const back = ctx.headFront + 0.002; // head centre in face coordinates
  return [-1, 1].map((sgn) => new THREE.CatmullRomCurve3([
    new THREE.Vector3(sgn * (ex + r), ey, 0.012),
    new THREE.Vector3(sgn * (side + 0.004), ey + 0.004, -0.07),
    new THREE.Vector3(sgn * restX, restY, -back),
    new THREE.Vector3(sgn * (restX - 0.01), restY - 0.05, -back - 0.05),
  ]));
}

function RoundGlasses({ ctx }: { ctx: WearCtx }) {
  const { ex, ey, r } = eyeLayout(ctx);
  const arms = useMemo(() => templeCurves(ctx, ex, r, ey).map((c) => new THREE.TubeGeometry(c, 28, 0.008, 6)), [ctx.headW, ctx.headFront, ctx.earTop, ctx.earOut, ex, r, ey]); // eslint-disable-line react-hooks/exhaustive-deps
  const bridge = useMemo(() => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-(ex - r), ey + r * 0.2, 0.014), new THREE.Vector3(0, ey + r * 0.55, 0.02), new THREE.Vector3(ex - r, ey + r * 0.2, 0.014),
  ), 12, 0.007, 6), [ex, ey, r]);
  return <group>
    {[-ex, ex].map((x) => <group key={x} position={[x, ey, 0.014]}>
      <mesh material={brass()}><torusGeometry args={[r, 0.009, 10, 40]} /></mesh>
      <mesh material={glass()}><circleGeometry args={[r, 32]} /></mesh>
    </group>)}
    <mesh geometry={bridge} material={brass()} />
    {arms.map((g, i) => <mesh key={i} geometry={g} material={brass()} />)}
  </group>;
}

function Goggles({ color, ctx }: { color: string; ctx: WearCtx }) {
  const { ex, ey, r } = eyeLayout(ctx);
  const strap = useMemo(() => {
    const side = ctx.headW / 2 + 0.03 + (ctx.earOut > 0 ? 0.02 : 0);
    const sy = ctx.earOut > 0 ? ctx.earTop + 0.03 : ey;
    const back = ctx.headFront + 0.002, rz = ctx.headD / 2 + 0.035;
    const pts: THREE.Vector3[] = [new THREE.Vector3(ex + r * 1.25, ey, 0.03), new THREE.Vector3(side, (ey + sy) / 2, -0.08)];
    // Back half of an ellipse around the head centre (z = −back): from the right side, behind, to the left side.
    for (let i = 0; i <= 24; i++) { const a = Math.PI / 2 + (i / 24) * Math.PI; pts.push(new THREE.Vector3(Math.sin(a) * side, sy, -back + Math.cos(a) * rz)); }
    pts.push(new THREE.Vector3(-side, (ey + sy) / 2, -0.08), new THREE.Vector3(-(ex + r * 1.25), ey, 0.03));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.02, 6);
  }, [ctx.headW, ctx.headD, ctx.headFront, ctx.earTop, ctx.earOut, ex, ey, r]); // eslint-disable-line react-hooks/exhaustive-deps
  return <group>
    {[-ex, ex].map((x) => <group key={x} position={[x, ey, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh material={robotMaterial("rubber", "#3A3F44")}><cylinderGeometry args={[r * 1.18, r * 1.25, 0.05, 32, 1, true]} /></mesh>
      <mesh material={robotMaterial("rubber", "#3A3F44")} position={[0, 0.025, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[r * 1.18, 0.014, 8, 32]} /></mesh>
      <mesh material={solidMaterial(color, { transparent: 0.4, rough: 0.05 })} position={[0, 0.02, 0]}><cylinderGeometry args={[r * 1.12, r * 1.12, 0.004, 32]} /></mesh>
    </group>)}
    <mesh material={robotMaterial("rubber", "#3A3F44")} position={[0, ey, 0.03]}><boxGeometry args={[Math.max(0.01, ex * 2 - r * 2.3), 0.03, 0.03]} /></mesh>
    <mesh geometry={strap} material={robotMaterial("rubber", "#2B2F33")} />
  </group>;
}

function Sunglasses({ ctx }: { ctx: WearCtx }) {
  const { ex, ey, r } = eyeLayout(ctx);
  const lens = useMemo(() => {
    const s = new THREE.Shape();
    const w = r * 1.35, h = r * 1.15;
    s.moveTo(-w, h * 0.55);
    s.bezierCurveTo(-w * 0.2, h * 0.75, w * 0.6, h * 0.75, w, h * 0.5);
    s.bezierCurveTo(w * 1.05, -h * 0.4, w * 0.4, -h * 1.1, -w * 0.2, -h);
    s.bezierCurveTo(-w * 0.9, -h * 0.8, -w * 1.05, 0, -w, h * 0.55);
    return new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 2 });
  }, [r]);
  const arms = useMemo(() => templeCurves(ctx, ex, r * 1.25, ey).map((c) => new THREE.TubeGeometry(c, 28, 0.007, 6)), [ctx.headW, ctx.headFront, ctx.earTop, ctx.earOut, ex, r, ey]); // eslint-disable-line react-hooks/exhaustive-deps
  const mirror = solidMaterial("#1a1c22", { metal: 0.9, rough: 0.05 });
  return <group>
    <mesh geometry={lens} material={mirror} position={[ex, ey, 0.014]} />
    <mesh geometry={lens} material={mirror} position={[-ex, ey, 0.022]} rotation={[0, Math.PI, 0]} />
    <mesh material={chrome()} position={[0, ey + r * 0.6, 0.02]}><boxGeometry args={[Math.max(0.01, ex * 2 - r * 2.5), 0.01, 0.01]} /></mesh>
    {arms.map((g, i) => <mesh key={i} geometry={g} material={chrome()} />)}
  </group>;
}


/* =====================================================================
   HAND ITEMS
   ===================================================================== */
function Beaker({ color }: { color: string }) {
  const b = useRef<THREE.Group>(null);
  useFrame(({ clock }) => b.current?.children.forEach((c, i) => { c.position.y = ((clock.elapsedTime * 0.25 + i * 0.3) % 1) * 0.16 - 0.04; }));
  const body = useMemo(() => lathe([[0, -0.1], [0.075, -0.1], [0.08, -0.09], [0.08, 0.08], [0.09, 0.1], [0.085, 0.105]], 32), []);
  const liquid = useMemo(() => lathe([[0, -0.095], [0.074, -0.095], [0.075, 0.02], [0, 0.02]], 32), []);
  return <group position={[0, -0.13, 0.08]}>
    <mesh geometry={body} material={glass()} />
    <mesh geometry={liquid} material={solidMaterial(color, { emissive: color, transparent: 0.7 })} />
    {[-0.06, -0.02, 0.02].map((y) => <mesh key={y} material={solidMaterial("#ffffff")} position={[0, y, 0.081]}><boxGeometry args={[0.03, 0.004, 0.002]} /></mesh>)}
    <group ref={b}>{[0, 1, 2].map((i) => <mesh key={i} material={solidMaterial("#dfffd8", { emissive: "#bfffb0" })} position={[(i - 1) * 0.025, 0, 0]}><sphereGeometry args={[0.012, 8, 6]} /></mesh>)}</group>
  </group>;
}
function Microscope({ color }: { color: string }) {
  const m = robotMaterial("painted_enamel", color);
  const armGeo = useMemo(() => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.08, -0.05), new THREE.Vector3(0, 0.05, -0.1), new THREE.Vector3(0, 0.1, -0.02)), 16, 0.022, 8), []);
  return <group position={[0, -0.12, 0.08]} scale={0.95}>
    <RoundedBox args={[0.13, 0.03, 0.16]} radius={0.01} smoothness={2} position={[0, -0.1, 0]} material={m} />
    <mesh geometry={armGeo} material={m} />
    <mesh material={black()} position={[0, -0.03, 0.02]}><boxGeometry args={[0.11, 0.012, 0.09]} /></mesh>
    <mesh material={chrome()} position={[0, 0.07, 0.03]} rotation={[0.45, 0, 0]}><cylinderGeometry args={[0.022, 0.026, 0.16, 16]} /></mesh>
    <mesh material={black()} position={[0, 0.155, -0.005]} rotation={[0.45, 0, 0]}><cylinderGeometry args={[0.026, 0.022, 0.03, 16]} /></mesh>
    <mesh material={chrome()} position={[0, -0.005, 0.05]}><cylinderGeometry args={[0.028, 0.028, 0.02, 16]} /></mesh>
    {[-0.012, 0.012].map((x) => <mesh key={x} material={chrome()} position={[x, -0.02, 0.055]}><cylinderGeometry args={[0.007, 0.005, 0.03, 8]} /></mesh>)}
  </group>;
}
function Calculator({ color }: { color: string }) {
  return <group position={[0, -0.12, 0.05]} rotation={[-0.4, 0, 0]}>
    <RoundedBox args={[0.12, 0.18, 0.025]} radius={0.01} smoothness={2} material={robotMaterial("toy_plastic", color)} />
    <mesh material={solidMaterial("#b8d8a0", { emissive: "#4a6a3a" })} position={[0, 0.05, 0.014]}><planeGeometry args={[0.09, 0.04]} /></mesh>
    {Array.from({ length: 12 }, (_, i) => <RoundedBox key={i} args={[0.022, 0.018, 0.01]} radius={0.004} smoothness={2} material={plastic(i === 11 ? "#E87A2C" : "#e6e6e6")} position={[-0.03 + (i % 3) * 0.03, 0.005 - Math.floor(i / 3) * 0.025, 0.015]} />)}
  </group>;
}
function Protractor({ color }: { color: string }) {
  const g = useMemo(() => { const s = new THREE.Shape(); s.absarc(0, 0, 0.12, 0, Math.PI, false); s.lineTo(0.12, 0); const h = new THREE.Path(); h.absarc(0, 0, 0.05, 0, Math.PI, false); h.lineTo(0.05, 0); s.holes.push(h); return new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false, curveSegments: 32 }); }, []);
  return <group position={[0, -0.12, 0.06]}><mesh geometry={g} material={solidMaterial(color, { transparent: 0.55, rough: 0.1 })} />
    {Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * Math.PI; return <mesh key={i} material={solidMaterial("#1e3a5a")} position={[Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.007]} rotation={[0, 0, a]}><boxGeometry args={[0.018, 0.003, 0.001]} /></mesh>; })}</group>;
}
function Pointer({ color }: { color: string }) {
  return <group position={[0, -0.1, 0.05]} rotation={[0.9, 0, -0.3]}><mesh material={robotMaterial("wood_panel")} position={[0, 0.2, 0]}><cylinderGeometry args={[0.008, 0.014, 0.45, 8]} /></mesh>
    <mesh material={solidMaterial(color === "#8B5A2B" ? "#f4f1e8" : color)} position={[0, 0.43, 0]}><sphereGeometry args={[0.012, 8, 6]} /></mesh></group>;
}
function Scroll() {
  return <group position={[0, -0.12, 0.06]} rotation={[0, 0, Math.PI / 2]}><mesh material={paper()}><cylinderGeometry args={[0.04, 0.04, 0.24, 16]} /></mesh>
    {[-0.13, 0.13].map((y) => <mesh key={y} material={wood()} position={[0, y, 0]}><cylinderGeometry args={[0.015, 0.015, 0.04, 8]} /></mesh>)}
    {[-0.15, 0.15].map((y) => <mesh key={`k${y}`} material={wood()} position={[0, y, 0]}><sphereGeometry args={[0.02, 8, 6]} /></mesh>)}
    <mesh material={solidMaterial("#b3202a")}><torusGeometry args={[0.042, 0.006, 6, 18]} /></mesh></group>;
}
function Quill({ color }: { color: string }) {
  const feather = useMemo(() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.05, 0.08, 0.015, 0.24); s.quadraticCurveTo(-0.03, 0.1, 0, 0); return new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }); }, []);
  return <group position={[0, -0.08, 0.05]} rotation={[0.3, 0, -0.4]}><mesh geometry={feather} material={clothMaterial(color)} />
    <mesh material={black()} position={[0, -0.02, 0]}><coneGeometry args={[0.006, 0.05, 6]} /></mesh></group>;
}
function Qalam() {
  return <group position={[0, -0.08, 0.05]} rotation={[0.3, 0, -0.5]}><mesh material={robotMaterial("wood_panel")} position={[0, 0.08, 0]}><cylinderGeometry args={[0.01, 0.012, 0.22, 8]} /></mesh>
    <mesh material={black()} position={[0, -0.04, 0]} rotation={[0, 0, 0.2]}><coneGeometry args={[0.01, 0.04, 4]} /></mesh></group>;
}
function globeTexture() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "#2f7fc4"; x.fillRect(0, 0, 256, 128);
  x.fillStyle = "#58a84a";
  const blobs: [number, number, number, number][] = [[40, 40, 26, 18], [60, 80, 14, 24], [120, 36, 22, 14], [135, 70, 18, 26], [190, 45, 30, 16], [205, 90, 14, 10], [230, 30, 10, 8]];
  for (const [bx, by, rx, ry] of blobs) { x.beginPath(); x.ellipse(bx, by, rx, ry, 0.4, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = "#f4f4f4"; x.fillRect(0, 0, 256, 8); x.fillRect(0, 120, 256, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function Globe({ desk }: { desk?: boolean }) {
  const g = useRef<THREE.Mesh>(null);
  const map = useMemo(globeTexture, []);
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.6; });
  return <group position={desk ? [0, 0.16, 0] : [0, -0.14, 0.07]} scale={desk ? 1.4 : 1}>
    <mesh ref={g} rotation={[0, 0, 0.4]}><sphereGeometry args={[0.08, 32, 20]} /><meshStandardMaterial map={map} roughness={0.35} /></mesh>
    <mesh material={brass()} rotation={[0, Math.PI / 2, 0.4]}><torusGeometry args={[0.09, 0.006, 6, 24, Math.PI * 1.4]} /></mesh>
    <mesh material={wood()} position={[0, -0.1, 0]}><cylinderGeometry args={[0.02, 0.05, 0.03, 14]} /></mesh>
  </group>;
}
function Compass({ color }: { color: string }) {
  return <group position={[0, -0.12, 0.06]} rotation={[Math.PI / 2 - 0.4, 0, 0]}><mesh material={robotMaterial("brass", color)}><cylinderGeometry args={[0.07, 0.07, 0.025, 24]} /></mesh>
    <mesh material={solidMaterial("#fff8de")} position={[0, 0.013, 0]}><cylinderGeometry args={[0.058, 0.058, 0.002, 24]} /></mesh>
    <mesh material={solidMaterial("#d11c1c")} position={[0, 0.016, 0.022]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.01, 0.045, 4]} /></mesh>
    <mesh material={solidMaterial("#1e3a5a")} position={[0, 0.016, -0.022]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.01, 0.045, 4]} /></mesh></group>;
}
function Book({ color }: { color: string }) {
  return <group position={[0, -0.12, 0.07]} rotation={[0.2, 0.3, 0]}>
    <RoundedBox args={[0.17, 0.22, 0.055]} radius={0.01} smoothness={2} material={robotMaterial("painted_enamel", color)} />
    <mesh material={paper()} position={[0.008, 0, 0]}><boxGeometry args={[0.16, 0.205, 0.045]} /></mesh>
    <mesh material={robotMaterial("gold")} position={[0, 0.04, 0.029]}><boxGeometry args={[0.09, 0.012, 0.002]} /></mesh>
    <mesh material={robotMaterial("gold")} position={[0, 0.015, 0.029]}><boxGeometry args={[0.06, 0.008, 0.002]} /></mesh>
  </group>;
}
function Laptop({ color }: { color: string }) {
  const m = robotMaterial("brushed_steel", color);
  return <group position={[0, -0.12, 0.1]}><RoundedBox args={[0.26, 0.012, 0.18]} radius={0.005} smoothness={2} material={m} />
    <mesh material={black()} position={[0, 0.007, 0.01]}><boxGeometry args={[0.22, 0.002, 0.09]} /></mesh>
    <group position={[0, 0, -0.09]} rotation={[-1.9, 0, 0]}><RoundedBox args={[0.26, 0.01, 0.18]} radius={0.005} smoothness={2} position={[0, 0, -0.09]} material={m} />
      <mesh material={solidMaterial("#1e3a5a", { emissive: "#2b6cb0" })} position={[0, 0.006, -0.09]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.23, 0.15]} /></mesh></group></group>;
}
function Duck({ color }: { color: string }) {
  const m = plastic(color);
  return <group position={[0, -0.12, 0.06]}><mesh material={m} scale={[1, 0.8, 1.2]}><sphereGeometry args={[0.07, 20, 14]} /></mesh>
    <mesh material={m} position={[0, 0.07, 0.04]}><sphereGeometry args={[0.045, 16, 12]} /></mesh>
    <mesh material={plastic("#E87A2C")} position={[0, 0.065, 0.09]} rotation={[Math.PI / 2, 0, 0]} scale={[1.4, 1, 0.5]}><coneGeometry args={[0.02, 0.04, 8]} /></mesh>
    {[-0.02, 0.02].map((x) => <mesh key={x} material={black()} position={[x, 0.085, 0.078]}><sphereGeometry args={[0.007, 6, 6]} /></mesh>)}</group>;
}
function Palette() {
  const g = useMemo(() => { const s = new THREE.Shape(); s.absellipse(0, 0, 0.13, 0.1, 0, Math.PI * 2, false, 0); const h = new THREE.Path(); h.absellipse(-0.07, -0.03, 0.022, 0.018, 0, Math.PI * 2, false, 0); s.holes.push(h); return new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 2 }); }, []);
  return <group position={[0, -0.12, 0.06]} rotation={[-0.5, 0, 0]}><mesh geometry={g} material={wood()} />
    {["#E8413C", "#F2B632", "#3E7CB1", "#57B846", "#8E5CC7"].map((c, i) => <mesh key={c} material={solidMaterial(c, { rough: 0.2 })} position={[Math.cos(i * 0.9 - 0.4) * 0.08, Math.sin(i * 0.9 - 0.4) * 0.06, 0.015]} scale={[1, 1, 0.4]}><sphereGeometry args={[0.016, 10, 8]} /></mesh>)}</group>;
}
function Brush({ color }: { color: string }) {
  return <group position={[0, -0.08, 0.05]} rotation={[0.4, 0, -0.3]}><mesh material={wood()} position={[0, 0.08, 0]}><cylinderGeometry args={[0.008, 0.012, 0.22, 8]} /></mesh>
    <mesh material={chrome()} position={[0, 0.2, 0]}><cylinderGeometry args={[0.013, 0.01, 0.03, 8]} /></mesh>
    <mesh material={solidMaterial(color)} position={[0, 0.235, 0]}><coneGeometry args={[0.013, 0.05, 8]} /></mesh></group>;
}
function Stopwatch() {
  return <group position={[0, -0.12, 0.06]} rotation={[Math.PI / 2 - 0.3, 0, 0]}><mesh material={chrome()}><cylinderGeometry args={[0.06, 0.06, 0.025, 24]} /></mesh>
    <mesh material={solidMaterial("#fffdf5")} position={[0, 0.013, 0]}><cylinderGeometry args={[0.05, 0.05, 0.002, 24]} /></mesh>
    <mesh material={solidMaterial("#d11c1c")} position={[0.012, 0.016, 0.01]} rotation={[0, 0.8, 0]}><boxGeometry args={[0.004, 0.002, 0.04]} /></mesh>
    <mesh material={chrome()} position={[0, 0, -0.07]}><cylinderGeometry args={[0.012, 0.012, 0.02, 8]} /></mesh></group>;
}
function Clipboard() {
  return <group position={[0, -0.12, 0.06]} rotation={[-0.3, 0, 0]}><RoundedBox args={[0.16, 0.22, 0.01]} radius={0.004} smoothness={2} material={wood()} />
    <mesh material={paper()} position={[0, -0.01, 0.006]}><planeGeometry args={[0.14, 0.18]} /></mesh>
    {[0.03, 0.0, -0.03, -0.06].map((y) => <mesh key={y} material={solidMaterial("#7aa0d0")} position={[0, y, 0.007]}><planeGeometry args={[0.11, 0.003]} /></mesh>)}
    <mesh material={chrome()} position={[0, 0.1, 0.008]}><boxGeometry args={[0.06, 0.025, 0.01]} /></mesh></group>;
}
function Telescope({ color }: { color: string }) {
  return <group position={[0, -0.1, 0.05]} rotation={[0.6, 0.4, 0]}>{[0, 1, 2].map((i) => <mesh key={i} material={robotMaterial("brass", color)} position={[0, i * 0.08, 0]}><cylinderGeometry args={[0.03 - i * 0.006, 0.03 - i * 0.006, 0.09, 16]} /></mesh>)}
    <mesh material={glass()} position={[0, -0.046, 0]}><cylinderGeometry args={[0.028, 0.028, 0.004, 16]} /></mesh></group>;
}
function Magnet() {
  return <group position={[0, -0.14, 0.06]}><mesh material={solidMaterial("#d63a3a", { rough: 0.3 })} rotation={[0, 0, Math.PI]}><torusGeometry args={[0.06, 0.022, 10, 20, Math.PI]} /></mesh>
    {[-0.06, 0.06].map((x) => <mesh key={x} material={chrome()} position={[x, 0.02, 0]}><boxGeometry args={[0.045, 0.04, 0.045]} /></mesh>)}</group>;
}



/* =====================================================================
   BACK — mounted on the outer surface (over any coat), straps follow the body
   ===================================================================== */
function outerShape(ctx: WearCtx, topId: string | null) {
  const style = topStyle(topId);
  const { sec, shape } = garmentShapeFor(ctx, style);
  return { sec, outer: { ...shape, gap: undefined, window: undefined } as GarmentShape, clothed: !!style };
}

/** Stable reference for items that drape onto the outer garment from elsewhere (the shemagh lives on the head). */
const outerShapeFor: OuterShapeFor = (ctx, topId) => { const { sec, outer } = outerShape(ctx, topId); return { sec, outer }; };

/** Headwear that drapes over head and shoulders (the head stays still and ears are covered while it's worn). */
export const DRAPES_SHOULDERS = (id: string | null | undefined) => !!id && ITEM_BY_ID.get(id)?.builder === "shemagh";

function Backpack({ color, ctx, topId }: { color: string; ctx: WearCtx; topId: string | null }) {
  const { sec, outer } = useMemo(() => outerShape(ctx, topId), [ctx.torsoVariant, ctx.torsoH, ctx.chestVisible, topId]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = yokeY(sec, outer);
  const backZ = garmentPoint(sec, outer, Math.PI, 0, 0, 0).z; // outer surface at the back (negative z)
  const bodyH = ctx.torsoH * 0.72, depth = 0.2;
  const straps = useMemo(() => [1, -1].map((sg) => surfaceTube(sec, outer, [
    [Math.PI - sg * 0.32, -ctx.torsoH * 0.3, 0], [Math.PI - sg * 0.4, top - 0.02, 0], [sg * (Math.PI / 2 + 0.35), top, 0.55],
    [sg * 0.62, top, 0.2], [sg * 0.55, top - 0.1, 0], [sg * 0.62, -ctx.torsoH * 0.1, 0],
  ], 0.028, 0.012, true)), [sec, outer, top, ctx.torsoH]);
  const m = clothMaterial(color);
  return <group>
    <group position={[0, -0.02, backZ - depth / 2 - 0.012]}>
      <RoundedBox args={[0.5, bodyH, depth]} radius={0.08} smoothness={4} material={m} castShadow receiveShadow />
      <RoundedBox args={[0.36, bodyH * 0.4, 0.08]} radius={0.04} smoothness={3} position={[0, -bodyH * 0.18, -depth / 2 - 0.03]} material={clothMaterial(shade(color, 0.85))} castShadow />
      <mesh material={chrome()} position={[0, bodyH * 0.32, -depth / 2 - 0.005]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.006, 0.006, 0.32, 6]} /></mesh>
      <mesh material={clothMaterial(shade(color, 0.7))} position={[0, bodyH / 2 + 0.03, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.05, 0.012, 8, 16, Math.PI]} /></mesh>
    </group>
    {straps.map((g, i) => <mesh key={i} geometry={g} material={clothMaterial(shade(color, 0.7))} castShadow />)}
  </group>;
}

function Jetpack({ color, ctx, topId }: { color: string; ctx: WearCtx; topId: string | null }) {
  const f = useRef<THREE.Group>(null);
  useFrame(({ clock }) => f.current?.children.forEach((c, i) => c.scale.setScalar(0.8 + Math.abs(Math.sin(clock.elapsedTime * 20 + i)) * 0.4)));
  const { sec, outer } = useMemo(() => outerShape(ctx, topId), [ctx.torsoVariant, ctx.torsoH, ctx.chestVisible, topId]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = yokeY(sec, outer);
  const backZ = garmentPoint(sec, outer, Math.PI, 0, 0, 0).z;
  const harness = useMemo(() => [1, -1].map((sg) => surfaceTube(sec, outer, [
    [Math.PI - sg * 0.3, -ctx.torsoH * 0.2, 0], [Math.PI - sg * 0.4, top - 0.02, 0], [sg * (Math.PI / 2 + 0.35), top, 0.55], [sg * 0.6, top, 0.2], [sg * 0.5, -ctx.torsoH * 0.05, 0],
  ], 0.022, 0.012, true)), [sec, outer, top, ctx.torsoH]);
  return <group>
    <group position={[0, 0, backZ - 0.1]}>
      <RoundedBox args={[0.36, 0.3, 0.06]} radius={0.02} smoothness={2} position={[0, 0.02, 0.06]} material={robotMaterial("brushed_steel", "#8f969b")} />
      {[-0.12, 0.12].map((x) => <group key={x} position={[x, 0, -0.02]}>
        <mesh material={robotMaterial("brushed_steel", color)} castShadow><cylinderGeometry args={[0.08, 0.08, 0.4, 28]} /></mesh>
        <mesh material={robotMaterial("brushed_steel", color)} position={[0, 0.2, 0]}><sphereGeometry args={[0.08, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        {[-0.12, 0.08].map((y) => <mesh key={y} material={chrome()} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.081, 0.006, 6, 28]} /></mesh>)}
        <mesh material={chrome()} position={[0, -0.23, 0]}><cylinderGeometry args={[0.05, 0.07, 0.06, 20]} /></mesh>
      </group>)}
      <group ref={f}>{[-0.12, 0.12].map((x) => <mesh key={x} material={solidMaterial("#ffb347", { emissive: "#ff7a00", transparent: 0.8 })} position={[x, -0.33, -0.02]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.05, 0.16, 14]} /></mesh>)}</group>
    </group>
    {harness.map((g, i) => <mesh key={i} geometry={g} material={robotMaterial("rubber", "#2B2F33")} />)}
  </group>;
}

function Cape({ color, ctx, topId }: { color: string; ctx: WearCtx; topId: string | null }) {
  const { sec, outer, clothed } = useMemo(() => outerShape(ctx, topId), [ctx.torsoVariant, ctx.torsoH, ctx.chestVisible, topId]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = yokeY(sec, outer);
  const { cape, cord } = useMemo(() => {
    const shape: GarmentShape = { ...outer, offset: (outer.offset ?? 0) + (clothed ? 0.022 : 0.03), drop: 0.46, flare: 0.3 };
    const win = (y: number, s: number): [number, number] => { const w = 1.0 + 0.25 * (s > 0 ? 0 : Math.min(1, (top - y) / ctx.torsoH)); return [Math.PI - w, Math.PI + w]; };
    return {
      cape: garmentGeometry(sec, { ...shape, window: win, sRange: [0, 0.82] }, 60),
      cord: ringAt(sec, outer, top, 0.82, 0.01, clothed ? 0.03 : 0.035, [-(Math.PI / 2 + 0.6), Math.PI / 2 + 0.6]),
    };
  }, [sec, outer, clothed, top, ctx.torsoH]);
  return <group>
    <mesh geometry={cape} material={clothMaterial(color)} castShadow receiveShadow />
    <mesh geometry={cord} material={robotMaterial("gold")} />
    <mesh material={robotMaterial("gold")} position={garmentPoint(sec, outer, 0, top, 0.82, clothed ? 0.04 : 0.045)}><sphereGeometry args={[0.028, 14, 10]} /></mesh>
  </group>;
}

function TeslaCoil({ ctx, topId }: { ctx: WearCtx; topId: string | null }) {
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#bfe9ff", emissive: "#6cf", emissiveIntensity: 1.5 }), []);
  useFrame(({ clock }) => { mat.emissiveIntensity = 1 + Math.random() * Math.abs(Math.sin(clock.elapsedTime * 8)); });
  const { sec, outer } = useMemo(() => outerShape(ctx, topId), [ctx.torsoVariant, ctx.torsoH, ctx.chestVisible, topId]); // eslint-disable-line react-hooks/exhaustive-deps
  const backZ = garmentPoint(sec, outer, Math.PI, 0.1, 0, 0).z;
  return <group position={[0, 0.05, backZ - 0.09]}>
    <mesh material={robotMaterial("brushed_steel", "#8f969b")} position={[0, 0, 0.07]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.1, 0.1, 0.03, 24]} /></mesh>
    <mesh material={black()} position={[0, 0.06, 0]}><cylinderGeometry args={[0.07, 0.08, 0.1, 20]} /></mesh>
    <mesh material={robotMaterial("copper")} geometry={helix(0.055, 0.34, 16, 0.011)} position={[0, 0.44, 0]} />
    <mesh material={black()} position={[0, 0.27, 0]}><cylinderGeometry args={[0.035, 0.035, 0.36, 12]} /></mesh>
    <mesh material={chrome()} position={[0, 0.48, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.1, 0.03, 14, 32]} /></mesh>
    <mesh material={mat} position={[0, 0.54, 0]}><sphereGeometry args={[0.05, 16, 12]} /></mesh>
  </group>;
}

/* =====================================================================
   BADGE & DESK PROPS
   ===================================================================== */
export function Badge({ item }: { item: Item }) {
  return <group>
    <mesh material={brass()} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.05, 0.05, 0.012, 24]} /></mesh>
    <mesh position={[0, 0, 0.007]}><circleGeometry args={[0.043, 24]} /><meshStandardMaterial map={symbolTexture(item.symbol ?? "★", item.color, item.color === "#FFFFFF" ? "#d11c1c" : "#fff")} roughness={0.3} /></mesh>
  </group>;
}

function SpecimenJar() {
  return <group position={[0, 0.12, 0]}><mesh material={glass()}><cylinderGeometry args={[0.09, 0.09, 0.22, 24]} /></mesh>
    <mesh material={solidMaterial("#9AD7A8", { transparent: 0.6 })} position={[0, -0.02, 0]}><cylinderGeometry args={[0.085, 0.085, 0.16, 24]} /></mesh>
    <mesh material={solidMaterial("#e89aa0")} scale={[1, 0.6, 1.6]}><sphereGeometry args={[0.035, 12, 10]} /></mesh>
    <mesh material={chrome()} position={[0, 0.12, 0]}><cylinderGeometry args={[0.095, 0.095, 0.03, 24]} /></mesh></group>;
}
function NewtonsCradle() {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const s = Math.sin(clock.elapsedTime * 4);
    if (g.current) { g.current.children[0].rotation.z = Math.min(0, s) * 0.6; g.current.children[4].rotation.z = Math.max(0, s) * 0.6; }
  });
  return <group><mesh material={wood()} position={[0, 0.01, 0]}><boxGeometry args={[0.34, 0.02, 0.16]} /></mesh>
    {[-0.15, 0.15].map((x) => <mesh key={x} material={chrome()} position={[x, 0.13, 0]}><boxGeometry args={[0.01, 0.24, 0.12]} /></mesh>)}
    <group ref={g} position={[0, 0.24, 0]}>{[-2, -1, 0, 1, 2].map((i) => <group key={i} position={[i * 0.042, 0, 0]}>
      <mesh material={solidMaterial("#555")} position={[0, -0.07, 0]}><cylinderGeometry args={[0.002, 0.002, 0.14, 4]} /></mesh>
      <mesh material={chrome()} position={[0, -0.15, 0]}><sphereGeometry args={[0.021, 16, 12]} /></mesh></group>)}</group></group>;
}
function TestTubes() {
  return <group><mesh material={wood()} position={[0, 0.06, 0]}><boxGeometry args={[0.3, 0.02, 0.08]} /></mesh>
    {["#ff6b6b", "#7cff6b", "#6ec6ff", "#ffd84d"].map((c, i) => <group key={c} position={[-0.105 + i * 0.07, 0.1, 0]}>
      <mesh material={glass()}><cylinderGeometry args={[0.018, 0.018, 0.18, 12]} /></mesh>
      <mesh material={solidMaterial(c, { emissive: c, transparent: 0.8 })} position={[0, -0.04, 0]}><cylinderGeometry args={[0.016, 0.016, 0.08, 12]} /></mesh></group>)}</group>;
}
function Abacus() {
  return <group position={[0, 0.12, 0]}><mesh material={wood()}><boxGeometry args={[0.3, 0.22, 0.02]} /></mesh>
    {[0, 1, 2, 3].map((r) => <group key={r} position={[0, 0.07 - r * 0.05, 0.02]}><mesh material={chrome()} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.003, 0.003, 0.26, 4]} /></mesh>
      {[0, 1, 2, 3, 4].map((b) => <mesh key={b} material={plastic(["#E8413C", "#F2B632", "#3E7CB1", "#57B846"][r])} position={[-0.1 + b * 0.025 + (r % 2) * 0.08, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 0.6, 1]}><sphereGeometry args={[0.014, 10, 8]} /></mesh>)}</group>)}</group>;
}
function Hourglass() {
  return <group position={[0, 0.13, 0]}>{[-0.12, 0.12].map((y) => <mesh key={y} material={wood()} position={[0, y, 0]}><cylinderGeometry args={[0.08, 0.08, 0.02, 20]} /></mesh>)}
    <mesh material={glass()} position={[0, 0.055, 0]}><coneGeometry args={[0.06, 0.11, 20, 1, true]} /></mesh>
    <mesh material={glass()} position={[0, -0.055, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.06, 0.11, 20, 1, true]} /></mesh>
    <mesh material={solidMaterial("#E8C874")} position={[0, -0.09, 0]}><coneGeometry args={[0.045, 0.04, 16]} /></mesh></group>;
}
function Inkwell() {
  return <group position={[0, 0.05, 0]}><mesh material={solidMaterial("#1E2A4A", { rough: 0.1, transparent: 0.85 })}><cylinderGeometry args={[0.06, 0.08, 0.1, 6]} /></mesh>
    <mesh material={brass()} position={[0, 0.06, 0]}><cylinderGeometry args={[0.03, 0.03, 0.03, 12]} /></mesh>
    <mesh material={clothMaterial("#f4f1e8")} position={[0.02, 0.18, 0]} rotation={[0, 0, -0.3]} scale={[0.3, 1, 0.08]}><sphereGeometry args={[0.1, 12, 10]} /></mesh></group>;
}
function BookStack() {
  return <group>{["#8E2C2C", "#2C5C8E", "#2E7D32", "#B8622A"].map((c, i) => <RoundedBox key={c} args={[0.24 - i * 0.02, 0.05, 0.17]} radius={0.006} smoothness={2} position={[0, 0.025 + i * 0.05, 0]} rotation={[0, i * 0.2 - 0.3, 0]} material={robotMaterial("painted_enamel", c)} />)}</group>;
}
function Metronome() {
  const a = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (a.current) a.current.rotation.z = Math.sin(clock.elapsedTime * 3.5) * 0.4; });
  return <group><mesh material={wood()} position={[0, 0.12, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[0.1, 0.24, 4]} /></mesh>
    <group ref={a} position={[0, 0.04, 0.06]}><mesh material={chrome()} position={[0, 0.1, 0]}><boxGeometry args={[0.008, 0.2, 0.008]} /></mesh><mesh material={brass()} position={[0, 0.14, 0]}><boxGeometry args={[0.03, 0.02, 0.015]} /></mesh></group></group>;
}
function Apple() {
  return <group position={[0, 0.07, 0]}><mesh material={solidMaterial("#D8252B", { rough: 0.2 })} scale={[1, 0.9, 1]}><sphereGeometry args={[0.07, 24, 18]} /></mesh>
    <mesh material={wood()} position={[0, 0.07, 0]}><cylinderGeometry args={[0.005, 0.006, 0.04, 6]} /></mesh>
    <mesh material={solidMaterial("#3F9E43")} position={[0.02, 0.08, 0]} rotation={[0, 0, -0.8]} scale={[1, 0.4, 0.2]}><sphereGeometry args={[0.03, 10, 8]} /></mesh></group>;
}


/* =====================================================================
   REGISTRY
   ===================================================================== */
type Builder = (props: { item: Item; color: string; ctx: WearCtx; desk?: boolean; topId: string | null }) => ReactNode;
const BUILDERS: Record<string, Builder> = {
  coat: ({ item, ctx }) => <TopGarment style={STYLES[item.id] ?? STYLES.lab_coat} ctx={ctx} />,
  vest: ({ item, ctx }) => <TopGarment style={STYLES[item.id] ?? STYLES.explorer_vest} ctx={ctx} />,
  hoodie: ({ item, ctx }) => <TopGarment style={STYLES[item.id] ?? STYLES.hoodie} ctx={ctx} />,
  thobe: ({ item, ctx }) => <TopGarment style={STYLES[item.id] ?? STYLES.thobe_coat} ctx={ctx} />,
  bowtie: ({ color, ctx, topId }) => <Neck kind="bowtie" color={color} ctx={ctx} topId={topId} />,
  tie: ({ color, ctx, topId, item }) => <Neck kind={item.id === "periodic_tie" ? "periodic" : "tie"} color={color} ctx={ctx} topId={topId} />,
  stethoscope: ({ color, ctx, topId }) => <Neck kind="stethoscope" color={color} ctx={ctx} topId={topId} />,
  whistle: ({ color, ctx, topId }) => <Neck kind="whistle" color={color} ctx={ctx} topId={topId} />,
  scarf: ({ color, ctx, topId }) => <Neck kind="scarf" color={color} ctx={ctx} topId={topId} />,
  brimHat: ({ color, ctx }) => <BrimHat color={color} ctx={ctx} />,
  tricorn: ({ color, ctx }) => <Tricorn color={color} ctx={ctx} />,
  beret: ({ color, ctx }) => <Beret color={color} ctx={ctx} />,
  spaceHelmet: ({ ctx }) => <SpaceHelmet ctx={ctx} />,
  gradCap: ({ color, ctx }) => <GradCap color={color} ctx={ctx} />,
  headband: ({ color, ctx }) => <Headband color={color} ctx={ctx} />,
  shemagh: ({ color, ctx, topId }) => <Shemagh color={color} ctx={ctx} topId={topId} shapeFor={outerShapeFor} />,
  roundGlasses: ({ ctx }) => <RoundGlasses ctx={ctx} />,
  goggles: ({ color, ctx }) => <Goggles color={color} ctx={ctx} />,
  sunglasses: ({ ctx }) => <Sunglasses ctx={ctx} />,
  microscope: ({ color }) => <Microscope color={color} />,
  beaker: ({ color }) => <Beaker color={color} />,
  calculator: ({ color }) => <Calculator color={color} />,
  protractor: ({ color }) => <Protractor color={color} />,
  pointer: ({ color }) => <Pointer color={color} />,
  scroll: () => <Scroll />,
  quill: ({ color }) => <Quill color={color} />,
  qalam: () => <Qalam />,
  globe: ({ desk }) => <Globe desk={desk} />,
  compass: ({ color }) => <Compass color={color} />,
  book: ({ color }) => <Book color={color} />,
  laptop: ({ color }) => <Laptop color={color} />,
  duck: ({ color }) => <Duck color={color} />,
  palette: () => <Palette />,
  brush: ({ color }) => <Brush color={color} />,
  stopwatch: () => <Stopwatch />,
  clipboard: () => <Clipboard />,
  telescope: ({ color }) => <Telescope color={color} />,
  magnet: () => <Magnet />,
  backpack: ({ color, ctx, topId }) => <Backpack color={color} ctx={ctx} topId={topId} />,
  jetpack: ({ color, ctx, topId }) => <Jetpack color={color} ctx={ctx} topId={topId} />,
  cape: ({ color, ctx, topId }) => <Cape color={color} ctx={ctx} topId={topId} />,
  teslaCoil: ({ ctx, topId }) => <TeslaCoil ctx={ctx} topId={topId} />,
  specimenJar: () => <SpecimenJar />,
  newtonsCradle: () => <NewtonsCradle />,
  testTubes: () => <TestTubes />,
  abacus: () => <Abacus />,
  hourglass: () => <Hourglass />,
  inkwell: () => <Inkwell />,
  bookStack: () => <BookStack />,
  metronome: () => <Metronome />,
  apple: () => <Apple />,
};

/** Items that sit on the head top (anything but a sweatband hides the antenna). */
export const HAT_HIDES_ANTENNA = (id: string | null | undefined) => !!id && ITEM_BY_ID.get(id)?.builder !== "headband";

export function WearItem({ id, ctx, desk, topId = null }: { id: string | null | undefined; ctx: WearCtx; desk?: boolean; topId?: string | null }) {
  if (!id) return null;
  const item = ITEM_BY_ID.get(id);
  if (!item) return null;
  if (item.slot === "badge") return <Badge item={item} />;
  const b = BUILDERS[item.builder];
  return b ? <>{b({ item, color: item.color, ctx, desk, topId })}</> : null;
}
