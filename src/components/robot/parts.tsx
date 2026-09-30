"use client";
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { robotMaterial, solidMaterial } from "./materials";
import { heartShape, helix, noodle } from "./geometry";
import type { RobotConfig } from "@/lib/schemas";

type Part = RobotConfig["body"]["head"];
const mat = (p: Part, fallback = "painted_enamel") => robotMaterial(p.material ?? fallback, p.tint, p.wear ?? 0);
const chrome = () => robotMaterial("polished_chrome");
const steel = () => robotMaterial("brushed_steel", "#b9bfc4");
const dark = () => solidMaterial("#1b1f22", { rough: 0.5 });
const groove = () => solidMaterial("#0f1214", { rough: 0.8 });
const rubber = () => robotMaterial("rubber", "#2B2F33");
const glassMat = () => solidMaterial("#cfefff", { rough: 0.05, transparent: 0.25 });

/* ------------------------------------------------------------- DETAIL KIT */
type V3 = [number, number, number];

/** Instanced dome-head rivets/bolts — cheap even by the hundred. */
export function Rivets({ pts, r = 0.011, material, hex = false }: { pts: V3[]; r?: number; material?: THREE.Material; hex?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    pts.forEach((p, i) => {
      // Orient each head outward from the local origin (works for rings and flat plates alike).
      const n = new THREE.Vector3(p[0], 0, p[2]);
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      q.setFromUnitVectors(up, n.normalize());
      m.compose(new THREE.Vector3(...p), q, s);
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [pts]);
  return (
    <instancedMesh key={pts.length} ref={ref} args={[undefined, undefined, pts.length]} material={material ?? chrome()} castShadow>
      {hex ? <cylinderGeometry args={[r, r, r * 0.9, 6]} /> : <sphereGeometry args={[r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />}
    </instancedMesh>
  );
}
const ring = (radius: number, y: number, n: number, rz = radius, phase = 0): V3[] =>
  Array.from({ length: n }, (_, i) => { const a = phase + (i / n) * Math.PI * 2; return [Math.sin(a) * radius, y, Math.cos(a) * rz]; });

/** Thin dark inset line (panel seam) along a box face. */
function Seam({ pos, size }: { pos: V3; size: V3 }) {
  return <mesh position={pos} material={groove()}><boxGeometry args={size} /></mesh>;
}

/** Row of vent slats. */
function Vents({ pos, rot = [0, 0, 0], n = 5, w = 0.14, gap = 0.028 }: { pos: V3; rot?: V3; n?: number; w?: number; gap?: number }) {
  return <group position={pos} rotation={rot}>
    {Array.from({ length: n }, (_, i) => <mesh key={i} position={[0, (i - (n - 1) / 2) * gap, 0]} material={groove()}><boxGeometry args={[w, 0.009, 0.006]} /></mesh>)}
  </group>;
}

/** Box whose back face is scaled down (CRT tube housing, tapered casings). Front face at z = +d/2. */
function taperedBox(wFront: number, hFront: number, wBack: number, hBack: number, d: number) {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const back = pos.getZ(i) < 0;
    pos.setXYZ(i, pos.getX(i) * (back ? wBack : wFront), pos.getY(i) * (back ? hBack : hFront), pos.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ HEAD */
export interface HeadSpec {
  w: number; h: number; front: number; top: number; bottom: number; screen: [number, number];
  /** Where a hat sits: crown radii where the head is that wide, height, and z centre. */
  hat: { rx: number; rz: number; y: number; cz: number };
}
export const HEAD_SPEC: Record<string, HeadSpec> = {
  cube: { w: 0.72, h: 0.6, front: 0.31, top: 0.3, bottom: -0.3, screen: [0.5, 0.36], hat: { rx: 0.37, rz: 0.31, y: 0.29, cz: 0 } },
  dome: { w: 0.76, h: 0.62, front: 0.4, top: 0.31, bottom: -0.29, screen: [0.46, 0.33], hat: { rx: 0.27, rz: 0.26, y: 0.22, cz: 0 } },
  crt_tv: { w: 0.84, h: 0.64, front: 0.34, top: 0.32, bottom: -0.32, screen: [0.56, 0.4], hat: { rx: 0.43, rz: 0.24, y: 0.315, cz: 0.07 } },
  capsule: { w: 0.86, h: 0.6, front: 0.34, top: 0.3, bottom: -0.3, screen: [0.48, 0.34], hat: { rx: 0.34, rz: 0.21, y: 0.22, cz: 0 } },
  tin_can: { w: 0.68, h: 0.64, front: 0.37, top: 0.31, bottom: -0.31, screen: [0.44, 0.32], hat: { rx: 0.355, rz: 0.355, y: 0.305, cz: 0 } },
  lightbulb: { w: 0.74, h: 0.8, front: 0.3, top: 0.46, bottom: -0.39, screen: [0.4, 0.29], hat: { rx: 0.26, rz: 0.26, y: 0.36, cz: 0 } },
  saucer: { w: 0.96, h: 0.5, front: 0.36, top: 0.37, bottom: -0.18, screen: [0.46, 0.3], hat: { rx: 0.2, rz: 0.2, y: 0.3, cz: 0 } },
  radio: { w: 0.82, h: 0.58, front: 0.23, top: 0.29, bottom: -0.29, screen: [0.46, 0.3], hat: { rx: 0.4, rz: 0.2, y: 0.28, cz: 0 } },
};
export const headSpec = (v: string) => HEAD_SPEC[v] ?? HEAD_SPEC.cube;

/** Ear extents for glasses/helmets: top of the ear (y) and how far it sticks out sideways. */
export const EAR_SPEC: Record<string, { top: number; out: number }> = {
  bolts: { top: 0.085, out: 0.1 }, headphones: { top: 0.14, out: 0.12 }, radar: { top: 0.16, out: 0.24 }, none: { top: 0, out: 0 },
};

function Bezel({ spec, children }: { spec: HeadSpec; children: ReactNode }) {
  const [sw, sh] = spec.screen;
  const W = sw + 0.08, H = sh + 0.08;
  return (
    <group position={[0, 0, spec.front - 0.05]}>
      <RoundedBox args={[W, H, 0.1]} radius={0.035} smoothness={4} material={dark()} castShadow />
      <Rivets pts={[[-W / 2 + 0.022, H / 2 - 0.022, 0.05], [W / 2 - 0.022, H / 2 - 0.022, 0.05], [-W / 2 + 0.022, -H / 2 + 0.022, 0.05], [W / 2 - 0.022, -H / 2 + 0.022, 0.05]]} r={0.008} hex />
      <group position={[0, 0, 0.052]}>{children}</group>
    </group>
  );
}

export function Head({ part, face, hideHandle }: { part: Part; face: ReactNode; hideHandle?: boolean }) {
  const m = mat(part);
  const spec = headSpec(part.variant);
  const filament = useMemo(() => helix(0.025, 0.08, 5, 0.004), []);
  const crtBack = useMemo(() => taperedBox(0.72, 0.54, 0.36, 0.3, 0.22), []);
  let body: ReactNode;
  switch (part.variant) {
    case "dome":
      body = <>
        <mesh material={m} scale={[1, 0.82, 0.95]} castShadow><sphereGeometry args={[0.38, 64, 40]} /></mesh>
        <mesh material={chrome()} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.382, 0.012, 10, 72]} /></mesh>
        <Rivets pts={ring(0.384, 0.028, 20, 0.364)} r={0.009} />
        <mesh material={chrome()} position={[0, -0.25, 0]}><cylinderGeometry args={[0.3, 0.33, 0.08, 48]} /></mesh>
        <Rivets pts={ring(0.325, -0.25, 16)} r={0.008} hex />
      </>;
      break;
    case "crt_tv":
      body = <>
        <RoundedBox args={[0.84, 0.64, 0.46]} radius={0.06} smoothness={5} position={[0, 0, 0.07]} material={m} castShadow />
        <mesh material={m} geometry={crtBack} position={[0, 0, -0.27]} castShadow />
        <Vents pos={[0, 0.321, 0.02]} rot={[-Math.PI / 2, 0, 0]} n={6} w={0.36} gap={0.034} />
        {[-0.18, -0.06].map((y, i) => <group key={y} position={[0.36, y, 0.31]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={robotMaterial("brass")}><cylinderGeometry args={[0.036 - i * 0.006, 0.038 - i * 0.006, 0.045, 24]} /></mesh>
          <mesh material={dark()} position={[0, 0.024, 0]}><boxGeometry args={[0.008, 0.004, 0.05 - i * 0.01]} /></mesh>
        </group>)}
        <mesh material={solidMaterial("#5dff6b", { emissive: "#33e61f" })} position={[0.36, 0.08, 0.3]}><sphereGeometry args={[0.012, 10, 8]} /></mesh>
        {Array.from({ length: 12 }, (_, i) => <mesh key={i} material={groove()} position={[-0.422, -0.1 + (i % 4) * 0.05, -0.05 + Math.floor(i / 4) * 0.07]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.009, 0.009, 0.006, 10]} /></mesh>)}
      </>;
      break;
    case "capsule":
      body = <>
        <mesh material={m} rotation={[0, 0, Math.PI / 2]} castShadow><capsuleGeometry args={[0.3, 0.26, 16, 40]} /></mesh>
        {[-0.13, 0.13].map((x) => <mesh key={x} material={chrome()} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.301, 0.01, 10, 56]} /></mesh>)}
      </>;
      break;
    case "tin_can":
      body = <>
        <mesh material={m} castShadow><cylinderGeometry args={[0.34, 0.34, 0.6, 56]} /></mesh>
        {[0.3, -0.3].map((y) => <mesh key={y} material={chrome()} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.343, 0.014, 10, 64]} /></mesh>)}
        {[0.2, 0.1, -0.1, -0.2].map((y) => <mesh key={y} material={chrome()} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.342, 0.006, 6, 64]} /></mesh>)}
        <mesh material={chrome()} position={[0, 0.302, 0]}><cylinderGeometry args={[0.33, 0.33, 0.004, 48]} /></mesh>
        <mesh material={chrome()} position={[0.12, 0.308, 0.1]} rotation={[-Math.PI / 2, 0, 0.6]}><torusGeometry args={[0.03, 0.006, 6, 16]} /></mesh>
      </>;
      break;
    case "lightbulb":
      body = <>
        <mesh material={glassMat()} position={[0, 0.08, 0]}><sphereGeometry args={[0.38, 48, 36]} /></mesh>
        <mesh material={solidMaterial("#9aa1a7", { metal: 0.8, rough: 0.3 })} position={[0, -0.12, -0.08]}><cylinderGeometry args={[0.012, 0.012, 0.3, 8]} /></mesh>
        <mesh geometry={filament} material={solidMaterial("#fff3b0", { emissive: "#ffcf4d" })} position={[0, 0.1, -0.08]} rotation={[0, 0, Math.PI / 2]} />
        <mesh material={robotMaterial("brass")} position={[0, -0.3, 0]} castShadow><cylinderGeometry args={[0.18, 0.14, 0.18, 32]} /></mesh>
        <mesh material={robotMaterial("brass")} geometry={helix(0.172, 0.14, 4, 0.012)} position={[0, -0.23, 0]} />
        <mesh material={dark()} position={[0, -0.39, 0]}><cylinderGeometry args={[0.07, 0.05, 0.03, 20]} /></mesh>
      </>;
      break;
    case "saucer":
      body = <>
        <mesh material={m} scale={[1, 0.36, 1]} castShadow><sphereGeometry args={[0.48, 64, 28]} /></mesh>
        <mesh material={chrome()} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.47, 0.012, 8, 72]} /></mesh>
        <mesh material={glassMat()} position={[0, 0.1, 0]}><sphereGeometry args={[0.28, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return <mesh key={i} material={solidMaterial(i % 2 ? "#ff6b6b" : "#ffe66b", { emissive: i % 2 ? "#ff3030" : "#ffd000" })} position={[Math.sin(a) * 0.43, -0.04, Math.cos(a) * 0.43]}><sphereGeometry args={[0.028, 12, 10]} /></mesh>;
        })}
      </>;
      break;
    case "radio":
      body = <>
        <RoundedBox args={[0.82, 0.58, 0.4]} radius={0.12} smoothness={6} material={m} castShadow />
        {!hideHandle && <mesh material={chrome()} position={[0, 0.29, 0]} rotation={[0, 0, 0]}><torusGeometry args={[0.13, 0.018, 10, 32, Math.PI]} /></mesh>}
        {[-0.3, 0.3].map((x) => <group key={x} position={[x, -0.1, 0.205]}>
          {Array.from({ length: 9 }, (_, i) => <mesh key={i} material={groove()} position={[((i % 3) - 1) * 0.03, (Math.floor(i / 3) - 1) * 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.008, 0.008, 0.004, 10]} /></mesh>)}
        </group>)}
      </>;
      break;
    default: // cube
      body = <>
        <RoundedBox args={[0.72, 0.6, 0.6]} radius={0.08} smoothness={5} material={m} castShadow />
        <Seam pos={[0, 0.12, 0]} size={[0.724, 0.008, 0.604]} />
        <Vents pos={[0, 0.301, -0.1]} rot={[-Math.PI / 2, 0, 0]} n={5} w={0.3} />
        {[-1, 1].map((sd) => <Rivets key={sd} pts={[[sd * 0.361, 0.2, 0.2], [sd * 0.361, 0.2, -0.2], [sd * 0.361, -0.2, 0.2], [sd * 0.361, -0.2, -0.2]].map((p) => p as V3)} r={0.012} hex />)}
      </>;
  }
  return <group>{body}<Bezel spec={spec}>{face}</Bezel></group>;
}

/* --------------------------------------------------------------- ANTENNA */
export function Antenna({ part }: { part: Part }) {
  const m = mat(part, "brass");
  const prop = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (prop.current) prop.current.rotation.y += dt * 9; });
  const base = <>
    <mesh material={chrome()} position={[0, 0.012, 0]}><cylinderGeometry args={[0.045, 0.055, 0.024, 20]} /></mesh>
    <Rivets pts={ring(0.042, 0.024, 4)} r={0.005} />
  </>;
  const stick = (h: number) => <mesh material={chrome()} position={[0, h / 2 + 0.02, 0]}><cylinderGeometry args={[0.009, 0.014, h, 10]} /></mesh>;
  const ball = (y: number, color = "#ff4d4d") => <mesh material={solidMaterial(color, { emissive: color, rough: 0.2 })} position={[0, y, 0]}><sphereGeometry args={[0.045, 20, 16]} /></mesh>;
  switch (part.variant) {
    case "none": return null;
    case "twin_balls":
      return <>{[-1, 1].map((s) => <group key={s} position={[s * 0.16, 0, 0]} rotation={[0, 0, -s * 0.35]}>{base}{stick(0.26)}{ball(0.3, s > 0 ? "#ffd84d" : "#ff4d4d")}</group>)}</>;
    case "dish":
      return <group>{base}{stick(0.2)}<mesh material={m} position={[0, 0.25, 0.02]} rotation={[-0.6, 0, 0]} castShadow><sphereGeometry args={[0.14, 32, 12, 0, Math.PI * 2, 0, Math.PI / 3]} /></mesh>
        <mesh material={chrome()} position={[0, 0.27, 0.07]} rotation={[-0.6, 0, 0]}><cylinderGeometry args={[0.005, 0.005, 0.12, 6]} /></mesh>{ball(0.31, "#8ef")}</group>;
    case "propeller":
      return <group>{base}{stick(0.16)}<group ref={prop} position={[0, 0.19, 0]}>
        <mesh material={m}><sphereGeometry args={[0.035, 16, 12]} /></mesh>
        {[0, Math.PI].map((r) => <mesh key={r} material={robotMaterial("toy_plastic", r ? "#E8413C" : "#3E7CB1")} rotation={[0.25, r, 0]} position={[Math.cos(r) * 0.14, 0, -Math.sin(r) * 0.14]} castShadow><boxGeometry args={[0.26, 0.01, 0.06]} /></mesh>)}
      </group></group>;
    case "lightning_rod":
      return <group>{base}{stick(0.3)}<mesh material={m} position={[0, 0.4, 0]}><coneGeometry args={[0.028, 0.18, 10]} /></mesh>
        {[0.16, 0.24].map((y) => <mesh key={y} material={chrome()} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.03, 0.005, 6, 16]} /></mesh>)}</group>;
    default:
      return <group>{base}{stick(0.3)}{ball(0.34)}</group>;
  }
}

/* ------------------------------------------------------------------ EARS */
export function Ears({ part, headW, headH, hideBand }: { part: Part; headW: number; headH: number; hideBand?: boolean }) {
  const m = mat(part, "brushed_steel");
  const x = headW / 2;
  switch (part.variant) {
    case "none": return null;
    case "headphones":
      return <group>
        {!hideBand && <mesh material={dark()} position={[0, 0, 0]}><torusGeometry args={[x + 0.045, 0.022, 10, 48, Math.PI]} /></mesh>}
        {[-1, 1].map((s) => <group key={s} position={[s * (x + 0.045), 0, 0]}>
          <mesh material={m} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.12, 0.12, 0.07, 36]} /></mesh>
          <mesh material={robotMaterial("rubber", "#3A3F44")} position={[-s * 0.04, 0, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.09, 0.028, 12, 32]} /></mesh>
          <mesh material={chrome()} position={[s * 0.037, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.05, 0.05, 0.006, 24]} /></mesh>
        </group>)}
        {hideBand && headH > 0 && null}
      </group>;
    case "radar":
      return <>{[-1, 1].map((s) => <group key={s} position={[s * x, 0.05, 0]}>
        <mesh material={chrome()} position={[s * 0.06, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.015, 0.015, 0.12, 10]} /></mesh>
        <mesh material={m} position={[s * 0.13, 0, 0]} rotation={[0, 0, -s * Math.PI / 2]} castShadow><sphereGeometry args={[0.1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 3]} /></mesh>
        <mesh material={solidMaterial("#ff4d4d", { emissive: "#ff2020" })} position={[s * 0.1, 0, 0]}><sphereGeometry args={[0.012, 8, 6]} /></mesh>
      </group>)}</>;
    default: // bolts
      return <>{[-1, 1].map((s) => <group key={s} position={[s * (x + 0.005), 0, 0]}>
        <mesh material={steel()} position={[s * 0.01, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.02, 32]} /></mesh>
        <mesh material={m} position={[s * 0.045, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.075, 0.075, 0.05, 6]} /></mesh>
        <mesh material={chrome()} position={[s * 0.078, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.03, 0.03, 0.02, 16]} /></mesh>
      </group>)}</>;
  }
}

/* ----------------------------------------------------------------- TORSO */
export const TORSO_FRONT: Record<string, number> = { barrel: 0.4, box: 0.28, oval: 0.36, radio: 0.26, vending: 0.29, boiler: 0.42 };

export function Torso({ part, h }: { part: Part; h: number }) {
  const m = mat(part, "brushed_steel");
  switch (part.variant) {
    case "box":
      return <group>
        <RoundedBox args={[0.8, h, 0.56]} radius={0.07} smoothness={5} material={m} castShadow receiveShadow />
        <Seam pos={[0, -h * 0.33, 0]} size={[0.804, 0.008, 0.564]} />
        {[-1, 1].map((s) => <Vents key={s} pos={[s * 0.401, -h * 0.12, 0]} rot={[0, s * Math.PI / 2, 0]} n={6} w={0.26} />)}
        <Rivets pts={[[-0.34, h / 2 - 0.05, 0.281], [0.34, h / 2 - 0.05, 0.281], [-0.34, -h / 2 + 0.05, 0.281], [0.34, -h / 2 + 0.05, 0.281], [-0.34, h / 2 - 0.05, -0.281], [0.34, h / 2 - 0.05, -0.281], [-0.34, -h / 2 + 0.05, -0.281], [0.34, -h / 2 + 0.05, -0.281]]} r={0.013} hex />
      </group>;
    case "oval":
      return <group>
        <mesh material={m} scale={[0.46, h / 2, 0.36]} castShadow receiveShadow><sphereGeometry args={[1, 64, 40]} /></mesh>
        <mesh material={chrome()} rotation={[Math.PI / 2, 0, 0]} scale={[0.462, 0.362, 1]}><torusGeometry args={[1, 0.03, 10, 72]} /></mesh>
        <Rivets pts={ring(0.466, 0.035, 24, 0.366)} r={0.009} />
      </group>;
    case "radio":
      return <group>
        <RoundedBox args={[0.84, h, 0.52]} radius={0.14} smoothness={6} material={m} castShadow receiveShadow />
        {[-1, 1].map((s) => <RoundedBox key={s} args={[0.03, h * 0.86, 0.36]} radius={0.012} smoothness={2} position={[s * 0.415, 0, 0]} material={robotMaterial("wood_panel")} castShadow />)}
        <mesh material={solidMaterial("#6b5a45", { rough: 0.95 })} position={[0, -h * 0.32, 0.262]}><planeGeometry args={[0.44, h * 0.2]} /></mesh>
        {[-0.13, 0.13].map((x) => <mesh key={x} material={robotMaterial("brass")} position={[x, -h * 0.32, 0.27]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.03, 0.032, 0.03, 20]} /></mesh>)}
      </group>;
    case "vending":
      return <group>
        <RoundedBox args={[0.78, h, 0.58]} radius={0.04} smoothness={3} material={m} castShadow receiveShadow />
        <mesh material={glassMat()} position={[-0.08, 0.05, 0.292]}><boxGeometry args={[0.46, h * 0.62, 0.02]} /></mesh>
        {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (
          <mesh key={`${r}${c}`} material={robotMaterial("toy_plastic", ["#E8413C", "#57B846", "#3E7CB1"][(r + c) % 3])} position={[-0.22 + c * 0.14, 0.2 - r * 0.16 * h, 0.24]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.08, 16]} /></mesh>
        )))}
        <mesh material={dark()} position={[0.29, -0.05, 0.292]}><boxGeometry args={[0.12, 0.3, 0.02]} /></mesh>
        <mesh material={chrome()} position={[0.29, 0.05, 0.303]}><boxGeometry args={[0.012, 0.05, 0.004]} /></mesh>
        <Rivets pts={[[-0.32, h / 2 - 0.04, 0.291], [0.32, h / 2 - 0.04, 0.291], [-0.32, -h / 2 + 0.04, 0.291], [0.32, -h / 2 + 0.04, 0.291]]} r={0.011} hex />
      </group>;
    case "boiler":
      return <group>
        <mesh material={m} castShadow receiveShadow><cylinderGeometry args={[0.42, 0.42, h, 56]} /></mesh>
        <mesh material={m} position={[0, h / 2, 0]} scale={[1, 0.35, 1]} castShadow><sphereGeometry args={[0.42, 56, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <Rivets pts={[...ring(0.422, h * 0.35, 28), ...ring(0.422, -h * 0.35, 28)]} r={0.011} material={robotMaterial("copper")} />
        <mesh material={robotMaterial("copper")} position={[0.27, 0, -0.27]}><cylinderGeometry args={[0.035, 0.035, h * 1.02, 16]} /></mesh>
        <group position={[-0.43, h * 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh material={robotMaterial("brass")}><cylinderGeometry args={[0.06, 0.06, 0.03, 24]} /></mesh>
          <mesh material={solidMaterial("#fff8de")} position={[0, 0.016, 0]}><cylinderGeometry args={[0.05, 0.05, 0.002, 24]} /></mesh>
        </group>
      </group>;
    default: // barrel
      return <group>
        <mesh material={m} castShadow receiveShadow><cylinderGeometry args={[0.4, 0.4, h, 56]} /></mesh>
        {[-0.4, 0, 0.4].map((f) => <mesh key={f} material={chrome()} position={[0, f * h, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.405, 0.016, 10, 72]} /></mesh>)}
        <Rivets pts={[...ring(0.402, h * 0.4 + 0.03, 24, 0.402, 0.13), ...ring(0.402, -h * 0.4 - 0.03, 24, 0.402, 0.13)]} r={0.009} />
        <Seam pos={[0, 0, -0.401]} size={[0.006, h, 0.006]} />
      </group>;
  }
}

/* ----------------------------------------------------------------- CHEST */
export function Chest({ variant, thinking }: { variant: string; thinking: boolean }) {
  const needle = useRef<THREE.Group>(null);
  const reels = useRef<THREE.Group>(null);
  const heart = useRef<THREE.Mesh>(null);
  const lights = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (needle.current) needle.current.rotation.z = Math.sin(t * (thinking ? 6 : 1.3)) * 0.8;
    if (reels.current) reels.current.children.forEach((c) => (c.rotation.z -= thinking ? 0.2 : 0.03));
    if (heart.current) heart.current.scale.setScalar(1.3 + Math.max(0, Math.sin(t * (thinking ? 9 : 4))) * 0.15);
    if (lights.current) lights.current.children.forEach((c, i) => { (c as THREE.Mesh).visible = !thinking || Math.sin(t * 10 + i * 2) > 0; });
  });
  const plate = <>
    <RoundedBox args={[0.4, 0.3, 0.03]} radius={0.02} smoothness={3} material={steel()} castShadow />
    <Rivets pts={[[-0.18, 0.13, 0.015], [0.18, 0.13, 0.015], [-0.18, -0.13, 0.015], [0.18, -0.13, 0.015]]} r={0.007} hex />
  </>;
  const lamp = (x: number, c: string) => <group position={[x, -0.1, 0.02]}>
    <mesh material={chrome()} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.021, 0.004, 6, 16]} /></mesh>
    <mesh material={solidMaterial(c, { emissive: c })}><sphereGeometry args={[0.018, 12, 10]} /></mesh>
  </group>;
  const lamps = <group ref={lights}>{lamp(-0.12, "#ff4d4d")}{lamp(0, "#ffd84d")}{lamp(0.12, "#5dff6b")}</group>;
  switch (variant) {
    case "blank": return null;
    case "dials":
      return <group>{plate}{[-0.11, 0, 0.11].map((x, i) => <group key={x} position={[x, 0.03, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh material={chrome()}><cylinderGeometry args={[0.048, 0.048, 0.01, 28]} /></mesh>
        <mesh material={dark()} position={[0, 0.012, 0]}><cylinderGeometry args={[0.04, 0.043, 0.024, 28]} /></mesh>
        <mesh material={solidMaterial("#fff")} position={[0, 0.026, 0.02]} rotation={[0, i, 0]}><boxGeometry args={[0.006, 0.004, 0.035]} /></mesh>
      </group>)}{lamps}</group>;
    case "tape_reels":
      return <group>{plate}<mesh material={glassMat()} position={[0, 0.02, 0.025]}><boxGeometry args={[0.34, 0.16, 0.004]} /></mesh>
        <group ref={reels}>{[-0.09, 0.09].map((x) => <group key={x} position={[x, 0.02, 0.018]}>
          <mesh material={solidMaterial("#3a2a1a")} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.068, 0.068, 0.012, 32]} /></mesh>
          {[0, 1, 2].map((k) => <mesh key={k} material={chrome()} position={[0, 0, 0.008]} rotation={[0, 0, (k * Math.PI) / 3]}><boxGeometry args={[0.12, 0.012, 0.004]} /></mesh>)}
          <mesh material={chrome()} position={[0, 0, 0.01]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.015, 0.015, 0.006, 12]} /></mesh>
        </group>)}</group>{lamps}</group>;
    case "heart":
      return <group>{plate}<mesh material={glassMat()} position={[0, 0.03, 0.028]}><sphereGeometry args={[0.09, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <mesh ref={heart} geometry={heartShape()} material={solidMaterial("#ff3b5c", { emissive: "#ff1040" })} position={[0, 0.03, 0.015]} scale={1.3} /></group>;
    case "keypad":
      return <group>{plate}
        <mesh material={solidMaterial("#b8d8a0", { emissive: "#3c5a2c" })} position={[0, 0.1, 0.017]}><planeGeometry args={[0.26, 0.05]} /></mesh>
        {Array.from({ length: 9 }, (_, i) => (
          <RoundedBox key={i} args={[0.07, 0.045, 0.022]} radius={0.008} smoothness={2} position={[-0.09 + (i % 3) * 0.09, 0.035 - Math.floor(i / 3) * 0.055, 0.02]} material={robotMaterial("toy_plastic", ["#F4F1E8", "#F2B632", "#E8413C"][i % 3])} />
        ))}</group>;
    default: // gauge
      return <group>{plate}
        <mesh material={solidMaterial("#fff8de")} position={[0, 0.02, 0.018]}><circleGeometry args={[0.1, 40]} /></mesh>
        {Array.from({ length: 9 }, (_, i) => { const a = -Math.PI * 0.75 + (i / 8) * Math.PI * 1.5; return <mesh key={i} material={dark()} position={[Math.sin(a) * 0.085, 0.02 + Math.cos(a) * 0.085, 0.019]} rotation={[0, 0, -a]}><boxGeometry args={[0.004, 0.018, 0.001]} /></mesh>; })}
        <mesh material={robotMaterial("brass")} position={[0, 0.02, 0.016]}><torusGeometry args={[0.1, 0.012, 10, 40]} /></mesh>
        <mesh material={glassMat()} position={[0, 0.02, 0.022]}><circleGeometry args={[0.1, 40]} /></mesh>
        <group ref={needle} position={[0, 0.02, 0.021]}><mesh material={solidMaterial("#d11c1c")} position={[0, 0.04, 0]}><boxGeometry args={[0.006, 0.08, 0.003]} /></mesh></group>
        <mesh material={dark()} position={[0, 0.02, 0.022]}><cylinderGeometry args={[0.008, 0.008, 0.004, 12]} /></mesh>
        {lamps}
      </group>;
  }
}

/* ------------------------------------------------------------------ ARMS */
/** Arm hanging from the shoulder pivot along −y. `covered` = inside a sleeve (use a straight arm). */
export function Arm({ part, length, covered }: { part: Part; length: number; covered?: boolean }) {
  const m = mat(part, "polished_chrome");
  const variant = covered && part.variant === "noodle" ? "tubes" : part.variant;
  const upper = length * 0.48, fore = length - upper;
  const hose = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, -0.03, -0.04), new THREE.Vector3(0.09, -upper * 0.6, -0.06), new THREE.Vector3(0.05, -length * 0.72, -0.03),
  ]), 20, 0.009, 6), [upper, length]);
  switch (variant) {
    case "springs": return <group>
      <mesh material={chrome()} position={[0, -0.02, 0]}><cylinderGeometry args={[0.06, 0.06, 0.03, 20]} /></mesh>
      <mesh material={m} geometry={helix(0.05, length - 0.06, Math.round(length * 16), 0.015)} position={[0, -0.035, 0]} castShadow />
      <mesh material={chrome()} position={[0, -length + 0.02, 0]}><cylinderGeometry args={[0.06, 0.06, 0.03, 20]} /></mesh>
    </group>;
    case "pistons":
      return <group>
        <mesh material={m} position={[0, -length * 0.28, 0]} castShadow><cylinderGeometry args={[0.058, 0.058, length * 0.56, 24]} /></mesh>
        {[-0.05, -length * 0.5].map((y) => <mesh key={y} material={chrome()} position={[0, y, 0]}><cylinderGeometry args={[0.064, 0.064, 0.02, 24]} /></mesh>)}
        <mesh material={chrome()} position={[0, -length * 0.74, 0]} castShadow><cylinderGeometry args={[0.032, 0.032, length * 0.46, 16]} /></mesh>
        <mesh material={dark()} position={[0, -length * 0.56, 0]}><cylinderGeometry args={[0.064, 0.064, 0.03, 24]} /></mesh>
        <mesh geometry={hose} material={rubber()} />
      </group>;
    case "noodle": return <mesh material={m} geometry={noodle(length, 0.12)} castShadow />;
    default: // tubes: upper arm, elbow joint, forearm, wrist
      return <group>
        <mesh material={m} position={[0, -upper / 2, 0]} castShadow><cylinderGeometry args={[0.05, 0.052, upper - 0.04, 20]} /></mesh>
        <group position={[0, -upper, 0]}>
          <mesh material={chrome()} castShadow><sphereGeometry args={[0.064, 24, 16]} /></mesh>
          {[-1, 1].map((s) => <mesh key={s} material={dark()} position={[s * 0.058, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.035, 0.035, 0.018, 18]} /></mesh>)}
        </group>
        <mesh material={m} position={[0, -upper - fore / 2, 0]} castShadow><cylinderGeometry args={[0.046, 0.04, fore - 0.06, 20]} /></mesh>
        <mesh material={chrome()} position={[0, -length + 0.03, 0]}><cylinderGeometry args={[0.05, 0.05, 0.025, 20]} /></mesh>
      </group>;
  }
}

/** Jointed finger: two segments curling forward (toward +z). */
function Finger({ len, r, curl, material }: { len: number; r: number; curl: number; material: THREE.Material }) {
  return <group rotation={[curl, 0, 0]}>
    <mesh material={material} position={[0, -len * 0.3, 0]} castShadow><capsuleGeometry args={[r, len * 0.45, 6, 12]} /></mesh>
    <group position={[0, -len * 0.62, 0]} rotation={[curl * 1.2, 0, 0]}>
      <mesh material={chrome()}><sphereGeometry args={[r * 1.05, 10, 8]} /></mesh>
      <mesh material={material} position={[0, -len * 0.22, 0]} castShadow><capsuleGeometry args={[r * 0.92, len * 0.3, 6, 12]} /></mesh>
    </group>
  </group>;
}

export function Hand({ part, side }: { part: Part; side: 1 | -1 }) {
  const m = mat(part, "toy_plastic");
  switch (part.variant) {
    case "claws":
      return <group>
        <mesh material={chrome()}><sphereGeometry args={[0.055, 20, 14]} /></mesh>
        <mesh material={m} position={[0, -0.05, 0]}><cylinderGeometry args={[0.05, 0.045, 0.04, 20]} /></mesh>
        {[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => (
          <group key={a} position={[Math.sin(a) * 0.035, -0.07, Math.cos(a) * 0.035]} rotation={[0, a, 0]}>
            <Finger len={0.12} r={0.013} curl={0.35} material={m} />
          </group>
        ))}
      </group>;
    case "grippers":
      return <group>
        <mesh material={chrome()}><cylinderGeometry args={[0.05, 0.05, 0.04, 20]} /></mesh>
        <RoundedBox args={[0.13, 0.035, 0.06]} radius={0.01} smoothness={2} position={[0, -0.04, 0]} material={m} />
        <mesh material={dark()} position={[0, -0.04, 0.031]}><boxGeometry args={[0.11, 0.008, 0.004]} /></mesh>
        {[-1, 1].map((s) => <group key={s} position={[s * 0.045, -0.1, 0]}>
          <RoundedBox args={[0.022, 0.1, 0.05]} radius={0.006} smoothness={2} material={m} castShadow />
          <mesh material={rubber()} position={[-s * 0.012, -0.02, 0]}><boxGeometry args={[0.006, 0.05, 0.04]} /></mesh>
        </group>)}
      </group>;
    case "suction":
      return <group>
        <mesh material={chrome()} position={[0, -0.03, 0]}><cylinderGeometry args={[0.025, 0.025, 0.08, 12]} /></mesh>
        <mesh material={chrome()} position={[0, -0.065, 0]}><cylinderGeometry args={[0.035, 0.035, 0.012, 16]} /></mesh>
        <mesh material={robotMaterial("rubber", part.tint ?? "#E8413C")} position={[0, -0.1, 0]}><coneGeometry args={[0.08, 0.07, 28, 1, true]} /></mesh>
        <mesh material={robotMaterial("rubber", part.tint ?? "#E8413C")} position={[0, -0.135, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.078, 0.008, 8, 28]} /></mesh>
      </group>;
    default: // mitts: palm, three curled fingers, thumb
      return <group>
        <mesh material={chrome()} position={[0, -0.005, 0]}><cylinderGeometry args={[0.045, 0.05, 0.03, 20]} /></mesh>
        <mesh material={m} position={[0, -0.06, 0]} scale={[1, 1.05, 0.62]} castShadow><sphereGeometry args={[0.07, 24, 16]} /></mesh>
        {[-0.035, 0, 0.035].map((x, i) => (
          <group key={x} position={[x, -0.11, 0.008]}>
            <Finger len={i === 1 ? 0.085 : 0.075} r={0.017} curl={0.3} material={m} />
          </group>
        ))}
        <group position={[side * -0.06, -0.06, 0.02]} rotation={[0.2, 0, side * 0.75]}>
          <Finger len={0.07} r={0.018} curl={0.25} material={m} />
        </group>
      </group>;
  }
}

/* ------------------------------------------------------------------ BASE */
export const BASE_HEIGHT = 0.5;

export function Base({ part, width }: { part: Part; width: number }) {
  const m = mat(part, "rubber");
  const wheel = useRef<THREE.Group>(null);
  const pogo = useRef<THREE.Group>(null);
  const treadLinks = useMemo(() => {
    // Links around a stadium-shaped belt (y 0.02–0.26, z ±0.24) — every link faces outward.
    const pts: V3[] = [];
    const R = 0.12, L = 0.36, n = 34, perim = 2 * L + 2 * Math.PI * R;
    for (let i = 0; i < n; i++) {
      let d = (i / n) * perim, y: number, z: number;
      if (d < L) { y = 0.26; z = -L / 2 + d; }
      else if ((d -= L) < Math.PI * R) { const a = d / R; y = 0.14 + Math.cos(a) * R; z = L / 2 + Math.sin(a) * R; }
      else if ((d -= Math.PI * R) < L) { y = 0.02; z = L / 2 - d; }
      else { d -= L; const a = d / R; y = 0.14 - Math.cos(a) * R; z = -L / 2 - Math.sin(a) * R; }
      pts.push([0, y, z]);
    }
    return pts;
  }, []);
  const tyreLugs = useMemo(() => Array.from({ length: 22 }, (_, i) => (i / 22) * Math.PI * 2), []);
  useFrame(({ clock }) => {
    if (wheel.current) wheel.current.rotation.x = Math.sin(clock.elapsedTime * 0.8) * 0.4;
    if (pogo.current) pogo.current.scale.y = 1 + Math.sin(clock.elapsedTime * 3) * 0.08;
  });
  switch (part.variant) {
    case "legs":
      return <group>{[-1, 1].map((s) => <group key={s} position={[s * 0.18 * width, 0, 0]}>
        <mesh material={chrome()} position={[0, 0.47, 0]}><sphereGeometry args={[0.07, 20, 14]} /></mesh>
        <mesh material={steel()} position={[0, 0.38, 0]} castShadow><cylinderGeometry args={[0.058, 0.05, 0.16, 20]} /></mesh>
        <group position={[0, 0.29, 0]}>
          <mesh material={chrome()} castShadow><sphereGeometry args={[0.062, 20, 14]} /></mesh>
          {[-1, 1].map((k) => <mesh key={k} material={dark()} position={[k * 0.055, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.034, 0.034, 0.016, 16]} /></mesh>)}
        </group>
        <mesh material={steel()} position={[0, 0.18, 0]} castShadow><cylinderGeometry args={[0.048, 0.056, 0.18, 20]} /></mesh>
        <mesh material={chrome()} position={[0, 0.09, 0]}><cylinderGeometry args={[0.06, 0.06, 0.03, 20]} /></mesh>
        <RoundedBox args={[0.2, 0.09, 0.32]} radius={0.04} smoothness={4} position={[0, 0.045, 0.05]} material={m} castShadow receiveShadow />
        <RoundedBox args={[0.19, 0.03, 0.08]} radius={0.012} smoothness={2} position={[0, 0.06, 0.2]} material={chrome()} />
        <mesh material={rubber()} position={[0, 0.006, 0.05]}><boxGeometry args={[0.2, 0.012, 0.31]} /></mesh>
      </group>)}</group>;
    case "wheel":
      return <group>
        <mesh material={chrome()} position={[0, 0.42, 0]}><cylinderGeometry args={[0.13, 0.09, 0.12, 28]} /></mesh>
        {[-1, 1].map((s) => <mesh key={s} material={steel()} position={[s * 0.1, 0.3, 0]} castShadow><boxGeometry args={[0.028, 0.22, 0.06]} /></mesh>)}
        <group ref={wheel} position={[0, 0.19, 0]}>
          <mesh material={m} rotation={[0, Math.PI / 2, 0]} castShadow><torusGeometry args={[0.14, 0.055, 20, 44]} /></mesh>
          {tyreLugs.map((a) => <mesh key={a} material={m} position={[0, Math.cos(a) * 0.192, Math.sin(a) * 0.192]} rotation={[a, 0, 0]}><boxGeometry args={[0.07, 0.012, 0.025]} /></mesh>)}
          <mesh material={robotMaterial("brass")} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.07, 32]} /></mesh>
          {[0, 1, 2, 3, 4].map((k) => <mesh key={k} material={chrome()} position={[0.037, Math.cos((k / 5) * Math.PI * 2) * 0.05, Math.sin((k / 5) * Math.PI * 2) * 0.05]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.009, 0.009, 0.01, 6]} /></mesh>)}
          <mesh material={chrome()} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.02, 0.02, 0.24, 12]} /></mesh>
        </group>
      </group>;
    case "hover":
      return <group>
        <mesh material={mat(part, "brushed_steel")} position={[0, 0.37, 0]} castShadow><cylinderGeometry args={[0.36 * width, 0.28 * width, 0.14, 56]} /></mesh>
        <mesh material={chrome()} position={[0, 0.44, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.36 * width, 0.012, 8, 64]} /></mesh>
        {Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return <mesh key={i} material={dark()} position={[Math.sin(a) * 0.25 * width, 0.29, Math.cos(a) * 0.25 * width]}><cylinderGeometry args={[0.04, 0.05, 0.03, 16]} /></mesh>; })}
        <mesh material={solidMaterial("#7cf", { emissive: "#39f" })} position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.2 * width, 0.02, 10, 48]} /></mesh>
        <mesh material={solidMaterial("#aef", { emissive: "#6cf", transparent: 0.3 })} position={[0, 0.14, 0]}><coneGeometry args={[0.22 * width, 0.28, 32, 1, true]} /></mesh>
      </group>;
    case "pogo":
      return <group>
        <mesh material={chrome()} position={[0, 0.4, 0]}><cylinderGeometry args={[0.03, 0.03, 0.22, 12]} /></mesh>
        {[-1, 1].map((s) => <group key={s} position={[s * 0.12, 0.31, 0]}>
          <mesh material={m} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.028, 0.028, 0.16, 12]} /></mesh>
          <RoundedBox args={[0.08, 0.03, 0.12]} radius={0.01} smoothness={2} position={[s * 0.06, 0, 0]} material={rubber()} />
        </group>)}
        <group ref={pogo} position={[0, 0.29, 0]}><mesh material={chrome()} geometry={helix(0.07, 0.22, 6, 0.014)} /></group>
        <mesh material={m} position={[0, 0.035, 0]} castShadow><cylinderGeometry args={[0.1, 0.12, 0.07, 28]} /></mesh>
      </group>;
    default: // treads: belt with individual links, drive + road wheels, armour plate
      return <group>{[-1, 1].map((s) => <group key={s} position={[s * 0.22 * width, 0, 0]}>
        <mesh material={m} position={[0, 0.14, 0]} castShadow receiveShadow><boxGeometry args={[0.16, 0.24, 0.36]} /></mesh>
        {[-0.18, 0.18].map((z) => <mesh key={z} material={m} position={[0, 0.14, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.12, 0.12, 0.16, 28]} /></mesh>)}
        <Rivets pts={treadLinks} r={0.016} material={robotMaterial("rubber", "#1f2224")} />
        {[-0.18, 0, 0.18].map((z) => <group key={z} position={[s * 0.085, 0.14, z]} rotation={[0, 0, Math.PI / 2]}>
          <mesh material={steel()}><cylinderGeometry args={[z === 0 ? 0.06 : 0.085, z === 0 ? 0.06 : 0.085, 0.02, 24]} /></mesh>
          <mesh material={chrome()} position={[0, 0.012, 0]}><cylinderGeometry args={[0.02, 0.02, 0.012, 12]} /></mesh>
        </group>)}
        <RoundedBox args={[0.02, 0.1, 0.46]} radius={0.008} smoothness={2} position={[s * 0.1, 0.27, 0]} material={mat(part, "brushed_steel")} />
      </group>)}
        <mesh material={chrome()} position={[0, 0.36, 0]} castShadow><cylinderGeometry args={[0.16, 0.2, 0.2, 32]} /></mesh>
        <mesh material={steel()} position={[0, 0.28, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.04, 0.04, 0.44 * width, 16]} /></mesh>
      </group>;
  }
}
