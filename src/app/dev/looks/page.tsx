"use client";
// Dev-only lookbook: every theme-pack outfit on a different torso/head, in one scene.
// ?view=front|side|back|three-quarter  ?row=0|1 (six robots, larger)  ?pose=idle|talking|thinking|wave
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { EffectComposer, N8AO } from "@react-three/postprocessing";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";
import { defaultRobot, THEME_PACKS } from "@/lib/catalog";
import { Robot } from "@/components/robot/Robot";
import type { RobotConfig } from "@/lib/schemas";
import type { RobotState } from "@/lib/types";

const LOOKS: [string, string, string, string, string][] = [
  ["biology", "box", "dome", "mitts", "legs"], ["music", "oval", "capsule", "claws", "treads"], ["arabic", "barrel", "cube", "grippers", "wheel"],
  ["computer_science", "radio", "tin_can", "mitts", "hover"], ["pe", "vending", "crt_tv", "suction", "legs"], ["medicine", "boiler", "lightbulb", "mitts", "treads"],
  ["mathematics", "barrel", "crt_tv", "claws", "legs"], ["history", "box", "radio", "mitts", "treads"], ["geography", "oval", "cube", "grippers", "pogo"],
  ["astronomy", "barrel", "saucer", "mitts", "hover"], ["chemistry", "box", "cube", "claws", "wheel"], ["literature", "radio", "dome", "mitts", "legs"],
];
const VIEW: Record<string, number> = { front: 0, "three-quarter": 0.6, side: Math.PI / 2, back: Math.PI };
// ?pack=<theme pack>: that one outfit on every head model (row 0) and every torso (row 1).
const PACK_LOOKS: [string, string, string, string][] = [
  ["barrel", "cube", "mitts", "legs"], ["barrel", "dome", "mitts", "treads"], ["box", "crt_tv", "claws", "wheel"],
  ["oval", "capsule", "grippers", "legs"], ["barrel", "tin_can", "mitts", "hover"], ["radio", "radio", "suction", "treads"],
  ["boiler", "lightbulb", "mitts", "legs"], ["barrel", "saucer", "mitts", "treads"], ["box", "cube", "claws", "legs"],
  ["vending", "tin_can", "mitts", "wheel"], ["oval", "dome", "grippers", "hover"], ["boiler", "crt_tv", "mitts", "pogo"],
];

export default function Looks() {
  const params = useSearchParams();
  const rot = VIEW[params.get("view") ?? "three-quarter"] ?? 0.6;
  const row = params.get("row");
  const pose = (params.get("pose") ?? "idle") as RobotState;
  const ears = params.get("ears") ?? "bolts";
  const pack = params.get("pack");
  const all: [string, string, string, string, string][] = pack ? PACK_LOOKS.map(([torso, head, hands, base]) => [pack, torso, head, hands, base]) : LOOKS;
  const soloParam = params.get("solo"); // ?solo=<index>: one robot, close up
  const solo = soloParam !== null;
  const list = solo ? [all[Number(soloParam) % all.length]] : row === null ? all : all.slice(Number(row) * 6, Number(row) * 6 + 6);
  const zoomY = Number(params.get("y") ?? 1.35), dist = Number(params.get("d") ?? 4.2);
  const configs: RobotConfig[] = list.map(([pack, torso, head, hands, base]) => {
    const c = defaultRobot();
    c.body.torso.variant = torso;
    c.body.head.variant = head;
    c.body.hands.variant = hands;
    c.body.base.variant = base;
    c.body.ears.variant = ears;
    c.body.arms.variant = "tubes";
    c.wardrobe = THEME_PACKS[pack].outfit;
    return c;
  });
  const single = row !== null || solo;
  return (
    <div style={{ height: "calc(100vh - 60px)", background: "#e8ebe9" }}>
      <Canvas shadows camera={{ position: solo ? [0, zoomY + 0.15, dist] : single ? [0, 1.5, 15] : [0, 1.4, 25], fov: 30 }} onCreated={({ gl, camera }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; camera.lookAt(0, solo ? zoomY : 1.2, 0); }}>
        <ambientLight intensity={0.28} />
        <directionalLight position={[3, 7, 8]} intensity={1.7} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004} shadow-normalBias={0.02}
          shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={6} shadow-camera-bottom={-4} />
        <directionalLight position={[-4, 3, -2]} intensity={0.55} color="#bcd4ff" />
        <Environment resolution={128}>
          <Lightformer form="rect" intensity={3} position={[0, 5, -3]} scale={[10, 3, 1]} />
          <Lightformer form="rect" intensity={1.5} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
          <Lightformer form="rect" intensity={1.5} position={[5, 1, 1]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
          <mesh scale={30}><sphereGeometry args={[1, 16, 8]} /><meshBasicMaterial color="#6f7673" side={THREE.BackSide} /></mesh>
        </Environment>
        {configs.map((c, i) => (
          <group key={i} position={solo ? [0, 0, 0] : single ? [(i - 2.5) * 2.2, 0, 0] : [(i % 6) * 2.3 - 5.75, i < 6 ? 2.7 : -0.6, 0]} rotation={[0, rot, 0]}>
            <Robot config={c} followCursor={false} state={pose} pointAtBoard={pose === "talking"} />
          </group>
        ))}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow><planeGeometry args={[30, 12]} /><shadowMaterial transparent opacity={0.25} /></mesh>
        {single && <ContactShadows position={[0, 0.002, 0]} opacity={0.4} scale={16} blur={2} far={2} />}
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <N8AO aoRadius={0.28} distanceFalloff={0.5} intensity={2.4} halfRes quality="medium" />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
