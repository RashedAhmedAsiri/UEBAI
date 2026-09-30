"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { RobotConfig } from "@/lib/schemas";
import type { RobotState } from "@/lib/types";
import { FaceScreen } from "./FaceScreen";
import { Antenna, Arm, Base, BASE_HEIGHT, Chest, EAR_SPEC, Ears, Hand, Head, headSpec, Rivets, Torso, TORSO_FRONT } from "./parts";
import { DRAPES_SHOULDERS, HAT_HIDES_ANTENNA, Sleeve, WearItem, garmentShapeFor, showsChest, topStyle, type WearCtx } from "./wardrobe";
import { CLOTH, garmentPoint, neckGap, sectionFor, taper } from "./garments";
import { robotMaterial, solidMaterial } from "./materials";

export type Reaction = { kind: "blink" | "look_up" | "ooh" | "dizzy" | "dance" | "wave" | "happy"; n: number };

export interface RobotProps {
  config: RobotConfig;
  state?: RobotState;
  reaction?: Reaction | null;
  /** 0..1 speaking loudness (TTS / streamed text). */
  talkLevel?: React.RefObject<number>;
  followCursor?: boolean;
  pointAtBoard?: boolean;
}

/** Radius of the sleeve cap at the shoulder; arms pivot just outside body + cloth + cap. */
const SLEEVE_CAP = 0.125;

/** Body layout derived from the config — shared by the robot and helpers (height, camera). */
export function robotLayout(config: RobotConfig) {
  const b = config.body, P = b.proportions;
  const torsoH = 0.9 * P.height;
  const sec = sectionFor(b.torso.variant);
  const spec = headSpec(b.head.variant);
  const y0 = BASE_HEIGHT;
  const gap = neckGap(sec);
  const neckTop = y0 + torsoH + gap;
  const headY = neckTop - spec.bottom * P.headSize;
  const shoulderLocalY = torsoH / 2 - 0.12;
  // Arms hang outside the torso *and* any clothing, so sleeves never cut into the body.
  const sideR = sec.a * taper(sec, shoulderLocalY, torsoH);
  const shoulderX = (sideR + CLOTH) * P.width + SLEEVE_CAP + 0.006;
  return { torsoH, sec, spec, y0, gap, neckTop, headY, shoulderY: y0 + torsoH - 0.12, shoulderX, sideX: sideR * P.width, armL: 0.55 * P.armLength };
}

export function Robot({ config, state = "idle", reaction, talkLevel, followCursor = true, pointAtBoard }: RobotProps) {
  const b = config.body;
  const P = b.proportions;
  const L = useMemo(() => robotLayout(config), [config]);
  const { torsoH, spec, y0, headY, shoulderY, shoulderX, armL } = L;
  const hs = P.headSize;
  const torsoFront = TORSO_FRONT[b.torso.variant] ?? 0.35;

  const face = useMemo(() => new FaceScreen(), []);
  useEffect(() => () => face.dispose(), [face]);

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const antenna = useRef<THREE.Group>(null);
  const armL_ = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const anim = useRef({ blinkUntil: 0, nextBlink: 2, reactKind: "" as Reaction["kind"] | "", reactStart: -10, antVel: 0, antAng: 0, lastHeadRot: 0 });

  const w = config.wardrobe;
  const top = topStyle(w.top);
  // A shemagh drapes from the head onto the shoulders, so the head holds still (the face screen still animates).
  const draped = DRAPES_SHOULDERS(w.headwear);
  const headLocked = useRef(draped);
  headLocked.current = draped;
  // Outward rest angle so hands clear a flared coat hem.
  const restSplay = useMemo(() => {
    if (!top) return 0.12;
    const hemX = (L.sec.a * (1 + top.flare) + CLOTH) * P.width + 0.1;
    return THREE.MathUtils.clamp(Math.asin(Math.min(1, Math.max(0, (hemX - shoulderX) / armL))) + 0.06, 0.12, 0.45);
  }, [top, L.sec, P.width, shoulderX, armL]);

  useEffect(() => {
    if (reaction) { anim.current.reactKind = reaction.kind; anim.current.reactStart = -1; }
  }, [reaction]);

  // Every opaque part casts and receives soft shadows; glass only receives.
  useEffect(() => {
    root.current?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      m.castShadow = !mat.transparent && !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      m.receiveShadow = !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
    });
  }, [config]);

  useFrame(({ clock, pointer }, dt) => {
    const t = clock.elapsedTime;
    const a = anim.current;
    if (a.reactStart === -1) a.reactStart = t;
    const rt = t - a.reactStart;
    const reacting = rt < 1.4 ? a.reactKind : "";

    if (t > a.nextBlink) { a.blinkUntil = t + 0.12; a.nextBlink = t + 2 + Math.random() * 3.5; }
    let faceState: RobotState = state;
    if (reacting === "ooh") faceState = "surprised";
    if (reacting === "happy" || reacting === "dance" || reacting === "wave") faceState = "happy";
    if (reacting === "dizzy") faceState = "confused";
    const blink = t < a.blinkUntil || (reacting === "blink" && rt < 0.25);

    face.draw({
      state: faceState, eyes: b.face.eyes, mouth: b.face.mouth, color: b.face.screenColor, t, blink,
      look: followCursor ? { x: pointer.x, y: -pointer.y } : { x: 0, y: 0 }, talk: talkLevel?.current ?? 0.6,
    });

    if (!root.current || !body.current || !head.current) return;
    const bobSpeed = state === "thinking" ? 5 : state === "talking" ? 3 : state === "sleeping" ? 0.8 : 2;
    const bobAmp = state === "sleeping" ? 0.008 : 0.02;
    root.current.position.y = Math.sin(t * bobSpeed) * bobAmp + (reacting === "happy" || reacting === "dance" ? Math.abs(Math.sin(rt * 10)) * 0.12 * (1.4 - rt) : 0);
    root.current.rotation.y = reacting === "dizzy" ? rt * Math.PI * 2 * 1.4 * Math.max(0, 1 - rt / 1.4) + rt * 2 : THREE.MathUtils.lerp(root.current.rotation.y, 0, 0.1);
    body.current.rotation.z = reacting === "dance" ? Math.sin(rt * 14) * 0.12 : THREE.MathUtils.lerp(body.current.rotation.z, 0, 0.1);
    body.current.rotation.x = THREE.MathUtils.lerp(body.current.rotation.x, state === "listening" ? 0.06 : state === "sleeping" ? 0.08 : 0, 0.08);

    // Head follows the cursor (limited so the chin never dips into the collar).
    const targetY = followCursor ? pointer.x * 0.5 : 0;
    let targetX = followCursor ? -pointer.y * 0.2 : 0;
    if (state === "listening") targetX = 0.18;
    if (state === "sleeping") targetX = 0.22;
    if (reacting === "look_up") targetX = -0.45;
    if (state === "talking") targetX += Math.sin(t * 7) * 0.035;
    const lock = headLocked.current;
    head.current.rotation.y = THREE.MathUtils.lerp(head.current.rotation.y, lock ? 0 : targetY, 0.08);
    head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, lock ? 0 : THREE.MathUtils.clamp(targetX, -0.5, 0.22), 0.08);
    head.current.rotation.z = !lock && (state === "confused" || reacting === "dizzy") ? Math.sin(t * 3) * 0.1 : THREE.MathUtils.lerp(head.current.rotation.z, 0, 0.1);

    if (antenna.current) {
      const hv = (head.current.rotation.y - a.lastHeadRot) / Math.max(dt, 1e-3);
      a.lastHeadRot = head.current.rotation.y;
      const force = -a.antAng * 60 - a.antVel * 5 - hv * 1.5 + (state === "thinking" ? Math.sin(t * 20) * 3 : 0);
      a.antVel += force * dt;
      a.antAng += a.antVel * dt;
      antenna.current.rotation.z = THREE.MathUtils.clamp(a.antAng, -0.6, 0.6);
      antenna.current.rotation.x = Math.sin(t * 1.7) * 0.04;
    }

    // Arms always stay on their own side of the body: every pose swings them outward or forward.
    if (armL_.current && armR.current) {
      const sway = Math.sin(t * 1.6) * 0.04;
      let rz = -restSplay - sway, lz = restSplay + sway, rx = 0, lx = 0;
      if (state === "talking") { rx = -0.45 - Math.sin(t * 4) * 0.25; rz = -restSplay - 0.12; }
      if (pointAtBoard && state === "talking") { rz = -1.9 + Math.sin(t * 3) * 0.1; rx = -0.2; }
      if (state === "thinking") { lx = -1.15; lz = restSplay + 0.35; }
      if (reacting === "wave") { rz = -2.6 + Math.sin(rt * 16) * 0.35; }
      if (reacting === "dance" || reacting === "happy") { rz = -2.4 + Math.sin(rt * 12) * 0.3; lz = 2.4 - Math.sin(rt * 12) * 0.3; }
      armR.current.rotation.z = THREE.MathUtils.lerp(armR.current.rotation.z, rz, 0.12);
      armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, rx, 0.12);
      armL_.current.rotation.z = THREE.MathUtils.lerp(armL_.current.rotation.z, lz, 0.12);
      armL_.current.rotation.x = THREE.MathUtils.lerp(armL_.current.rotation.x, lx, 0.12);
    }
  });

  const earSpec = EAR_SPEC[b.ears.variant] ?? EAR_SPEC.none;
  const chestVisible = b.chest.variant !== "blank" && showsChest(top);
  const ctx: WearCtx = useMemo(() => ({
    torsoH, torsoVariant: b.torso.variant, chestVisible,
    headW: spec.w, headH: spec.h, headD: 2 * (spec.front - 0.04), headTop: spec.top, headBottom: spec.bottom, headFront: spec.front, screen: spec.screen,
    hat: spec.hat, earTop: earSpec.top, earOut: earSpec.out,
    headVariant: b.head.variant, body: { hs, gap: L.gap, W: P.width, D: 0.5 + 0.5 * P.width },
  }), [torsoH, b.torso.variant, chestVisible, spec, earSpec, b.head.variant, hs, L.gap, P.width]);
  const [sw, sh] = spec.screen;
  const hatOn = !!w.headwear;
  const faceMat = useMemo(() => new THREE.MeshBasicMaterial({ map: face.texture, toneMapped: false }), [face]);
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#ffffff", transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, clearcoat: 1 }), []);

  // Badges: upper chest (above the dashboard) and lower flank, beside any coat opening, never over the dashboard.
  const badges = useMemo(() => {
    const { sec, shape } = garmentShapeFor(ctx, top);
    return ([[0.72, 0.3], [-0.72, 0.3], [1.0, 0.06]] as const).map(([th, fy]) => {
      const y = torsoH * fy;
      const gap = shape.gap?.(y, 0) ?? 0;
      const theta = Math.sign(th) * Math.max(Math.abs(th), gap + 0.14);
      return { pos: garmentPoint(sec, shape, theta, y, 0, 0.016), theta };
    });
  }, [ctx, top, torsoH]);

  const neckLen = L.gap;
  const ribs = Math.max(3, Math.round(neckLen / 0.03));

  const shoulder = (side: 1 | -1) => (
    <group position={[side * (L.sideX - 0.01), shoulderY, 0]}>
      {/* mounting plate on the torso side + axle out to the joint */}
      <mesh material={robotMaterial("brushed_steel", "#9aa1a7")} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.02, 32]} /></mesh>
      <Rivets pts={[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * Math.PI * 2; return [side * 0.011, Math.cos(a) * 0.075, Math.sin(a) * 0.075] as [number, number, number]; })} r={0.008} hex />
      <mesh material={robotMaterial("polished_chrome")} position={[side * (shoulderX - L.sideX + 0.01) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.04, 0.04, shoulderX - L.sideX + 0.01, 16]} /></mesh>
    </group>
  );

  const arm = (side: 1 | -1, ref: React.RefObject<THREE.Group | null>, item: string | null) => (
    <group ref={ref} position={[side * shoulderX, shoulderY, 0]}>
      <mesh material={robotMaterial("polished_chrome")}><sphereGeometry args={[0.08, 24, 16]} /></mesh>
      <Arm part={b.arms} length={armL} covered={!!top && top.sleeve !== "none"} />
      {top && <Sleeve style={top} armLength={armL} />}
      <group name={side > 0 ? "left_hand" : "right_hand"} position={[0, -armL, 0]}>
        <Hand part={b.hands} side={side} />
        <WearItem id={item} ctx={ctx} />
      </group>
    </group>
  );

  return (
    <group ref={root}>
      <group name="base"><Base part={b.base} width={P.width} /></group>
      <group ref={body}>
        {/* waist: rubber bellows between base and torso */}
        <group name="waist" position={[0, y0 - 0.035, 0]}>
          {[0, 1, 2].map((i) => <mesh key={i} material={robotMaterial("rubber", "#3A3F44")} position={[0, i * 0.022, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.19, 0.016, 10, 40]} /></mesh>)}
          <mesh material={robotMaterial("rubber", "#2B2F33")} position={[0, 0.022, 0]}><cylinderGeometry args={[0.185, 0.185, 0.07, 32]} /></mesh>
        </group>
        <group position={[0, y0 + torsoH / 2, 0]} scale={[P.width, 1, 0.5 + 0.5 * P.width]}>
          <Torso part={b.torso} h={torsoH} />
          <group name="torso_front" position={[0, torsoH * 0.02, torsoFront + 0.01]}>
            {chestVisible && <>
              {/* backing block so the flat dashboard sits flush on curved torsos */}
              <RoundedBox args={[0.38, 0.28, 0.07]} radius={0.015} smoothness={2} position={[0, 0, -0.04]} material={robotMaterial("brushed_steel", "#8f969b")} />
              <Chest variant={b.chest.variant} thinking={state === "thinking"} />
            </>}
          </group>
          <group name="torso_back"><WearItem id={w.back} ctx={ctx} topId={w.top} /></group>
          <WearItem id={w.top} ctx={ctx} />
          <WearItem id={w.neck} ctx={ctx} topId={w.top} />
          {w.badges.map((id, i) => badges[i] && <group key={id} position={badges[i].pos} rotation={[0, badges[i].theta, 0]}><WearItem id={id} ctx={ctx} /></group>)}
        </group>
        {shoulder(1)}
        {shoulder(-1)}
        {/* neck: ribbed bellows sized to clear collars, scarves and domes */}
        <group name="neck" position={[0, y0 + torsoH, 0]}>
          <mesh material={robotMaterial("rubber", "#2B2F33")} position={[0, neckLen / 2, 0]}><cylinderGeometry args={[0.07, 0.08, neckLen, 20]} /></mesh>
          {Array.from({ length: ribs }, (_, i) => <mesh key={i} material={robotMaterial("rubber", "#3A3F44")} position={[0, 0.015 + (i * (neckLen - 0.03)) / Math.max(1, ribs - 1), 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.078, 0.013, 8, 28]} /></mesh>)}
          <mesh material={robotMaterial("polished_chrome")} position={[0, neckLen - 0.01, 0]}><cylinderGeometry args={[0.1, 0.09, 0.03, 28]} /></mesh>
        </group>
        <group ref={head} position={[0, headY, 0]}>
          <group scale={hs}>
            <Head part={b.head} hideHandle={hatOn} face={<group name="face">
              <mesh material={faceMat}><planeGeometry args={[sw, sh]} /></mesh>
              <mesh material={glass} position={[0, 0, 0.004]}><planeGeometry args={[sw, sh]} /></mesh>
              <WearItem id={w.eyewear} ctx={ctx} />
            </group>} />
            {/* ears are under the cloth when a shemagh is worn */}
            {!draped && <group name="ears"><Ears part={b.ears} headW={spec.w} headH={spec.h} hideBand={hatOn} /></group>}
            <group name="head_top" position={[0, spec.top, 0]}>
              {!HAT_HIDES_ANTENNA(w.headwear) && <group ref={antenna}><Antenna part={b.antenna} /></group>}
              <WearItem id={w.headwear} ctx={ctx} topId={w.top} />
            </group>
          </group>
        </group>
        {arm(-1, armR, w.rightHand)}
        {arm(1, armL_, w.leftHand)}
      </group>
    </group>
  );
}

export function robotHeight(config: RobotConfig) {
  const L = robotLayout(config);
  return L.headY + L.spec.top * config.body.proportions.headSize + 0.3;
}

/** Desk for the Classroom scene (with the desk prop on top). */
export function TeacherDesk({ prop }: { prop: string | null }) {
  const ctx: WearCtx = {
    torsoH: 0.9, torsoVariant: "barrel", chestVisible: true, headW: 0.7, headH: 0.6, headD: 0.6, headTop: 0.3, headBottom: -0.3, headFront: 0.3, screen: [0.5, 0.36],
    hat: { rx: 0.35, rz: 0.3, y: 0.3, cz: 0 }, earTop: 0, earOut: 0,
  };
  const wood = robotMaterial("wood_panel");
  return (
    <group>
      <RoundedBox args={[1.3, 0.07, 0.7]} radius={0.015} smoothness={2} position={[0, 0.8, 0]} material={wood} castShadow receiveShadow />
      <mesh material={wood} position={[0, 0.42, 0.3]} castShadow receiveShadow><boxGeometry args={[1.24, 0.7, 0.04]} /></mesh>
      {[-0.58, 0.58].map((x) => <mesh key={x} material={wood} position={[x, 0.4, 0]} castShadow receiveShadow><boxGeometry args={[0.08, 0.78, 0.64]} /></mesh>)}
      {[-0.3, 0.3].map((x) => <mesh key={`h${x}`} material={robotMaterial("brass")} position={[x, 0.62, 0.325]}><boxGeometry args={[0.12, 0.018, 0.018]} /></mesh>)}
      <mesh material={solidMaterial("#f4ecd6", { rough: 0.9 })} position={[-0.3, 0.8355, 0.05]} rotation={[-Math.PI / 2, 0, 0.2]} receiveShadow><planeGeometry args={[0.28, 0.36]} /></mesh>
      <group position={[0.25, 0.835, 0]}><WearItem id={prop} ctx={ctx} desk /></group>
    </group>
  );
}
