"use client";
import { forwardRef, memo, Suspense, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RobotConfig } from "@/lib/schemas";
import type { RobotState } from "@/lib/types";
import { Robot, robotHeight, TeacherDesk, type Reaction } from "./Robot";
import { robotMaterial } from "./materials";
import { useI18n } from "@/lib/client/i18n";

export type Focus = "head" | "body" | "arms" | "base" | "all";
export interface RobotStageHandle { snapshot: () => string | null }

interface Props {
  config: RobotConfig;
  mode?: "workshop" | "classroom" | "boot";
  state?: RobotState;
  reaction?: Reaction | null;
  focus?: Focus;
  talkLevel?: React.RefObject<number>;
  fallbackImage?: string | null;
  pointAtBoard?: boolean;
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

function CameraRig({ focus, height, controls }: { focus: Focus; height: number; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const goal = useRef<{ target: THREE.Vector3; dist: number } | null>(null);
  useEffect(() => {
    const y = focus === "head" ? height - 0.45 : focus === "base" ? 0.35 : focus === "body" || focus === "arms" ? height * 0.5 : height * 0.48;
    const dist = focus === "all" ? 3.7 + (height - 2) * 1.2 : 2.3;
    goal.current = { target: new THREE.Vector3(0, y, 0), dist };
  }, [focus, height]);
  useFrame(() => {
    const c = controls.current;
    if (!c || !goal.current) return;
    c.target.lerp(goal.current.target, 0.08);
    const dir = camera.position.clone().sub(c.target).normalize();
    const want = c.target.clone().add(dir.multiplyScalar(goal.current.dist));
    camera.position.lerp(want, 0.08);
    c.update();
    if (camera.position.distanceTo(want) < 0.01 && c.target.distanceTo(goal.current.target) < 0.01) goal.current = null;
  });
  return null;
}

function Snapshotter({ handle }: { handle: React.RefObject<(() => string | null) | null> }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    handle.current = () => {
      // Fixed portrait camera for thumbnails and chat avatars.
      const cam = new THREE.PerspectiveCamera(30, 0.8, 0.1, 50);
      const size = gl.getSize(new THREE.Vector2());
      const h = 2.4;
      cam.position.set(0.9, h * 0.62, 5.2);
      cam.lookAt(0, h * 0.46, 0);
      const target = new THREE.WebGLRenderTarget(400, 500, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(scene, cam);
      const buf = new Uint8Array(400 * 500 * 4);
      gl.readRenderTargetPixels(target, 0, 0, 400, 500, buf);
      gl.setRenderTarget(null);
      target.dispose();
      const c = document.createElement("canvas");
      c.width = 400; c.height = 500;
      const ctx = c.getContext("2d")!;
      const img = ctx.createImageData(400, 500);
      for (let y = 0; y < 500; y++) img.data.set(buf.subarray((499 - y) * 1600, (500 - y) * 1600), y * 1600);
      ctx.putImageData(img, 0, 0);
      gl.setSize(size.x, size.y, false);
      gl.render(scene, camera);
      return c.toDataURL("image/webp", 0.85);
    };
  }, [gl, scene, camera, handle]);
  return null;
}

// memo: pages re-render on every streamed token; the 3D scene should not.
export const RobotStage = memo(forwardRef<RobotStageHandle, Props>(function RobotStage(
  { config, mode = "workshop", state = "idle", reaction, focus = "all", talkLevel, fallbackImage, pointAtBoard }, ref,
) {
  const { t } = useI18n();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const snap = useRef<(() => string | null) | null>(null);
  const controls = useRef<OrbitControlsImpl | null>(null);
  useEffect(() => setWebgl(hasWebGL()), []);
  useImperativeHandle(ref, () => ({ snapshot: () => snap.current?.() ?? null }), []);
  useEffect(() => {
    // Dev-only: lets tooling grab a full-body portrait of the current robot.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __robotSnap?: () => string | null }).__robotSnap = () => snap.current?.() ?? null;
  }, []);
  const height = robotHeight(config);

  if (webgl === false) {
    return fallbackImage
      ? <img src={fallbackImage} alt={t("Robot teacher")} style={{ width: "100%", height: "100%", objectFit: "contain", animation: "bob 3s ease-in-out infinite" }} />
      : <div className="center muted" style={{ padding: 40 }}>{t("3D is not available on this device.")}</div>;
  }
  if (webgl === null) return null;

  const classroom = mode === "classroom";
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
      camera={{ position: classroom ? [0.5, 1.7, 6.2] : [0, 1.4, 4.2], fov: classroom ? 30 : 35 }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.28} />
        {/* Key light with a tight shadow frustum around the robot for crisp, soft-edged shadows. */}
        <directionalLight
          position={[2.6, 5.5, 4]} intensity={1.7} castShadow
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={4}
          shadow-camera-left={-2} shadow-camera-right={2} shadow-camera-top={3.2} shadow-camera-bottom={-0.6} shadow-camera-near={0.5} shadow-camera-far={14}
        />
        <directionalLight position={[-4, 3, -2]} intensity={0.55} color="#bcd4ff" />
        <directionalLight position={[0, 2.5, -5]} intensity={0.45} color="#ffffff" />
        {/* Studio HDRI built from light panels (no network download). */}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3} position={[0, 5, -3]} scale={[10, 3, 1]} />
          <Lightformer form="rect" intensity={1.5} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color="#ffe6c4" />
          <Lightformer form="rect" intensity={1.5} position={[5, 1, 1]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} color="#cfe3ff" />
          <Lightformer form="ring" intensity={2} position={[0, 2, 6]} scale={3} />
          <mesh scale={30}><sphereGeometry args={[1, 32, 16]} /><meshBasicMaterial color="#6f7673" side={THREE.BackSide} /></mesh>
        </Environment>

        <group position={classroom ? [-0.55, 0, 0] : [0, 0, 0]} rotation={classroom ? [0, 0.35, 0] : [0, 0, 0]}>
          <Robot config={config} state={state} reaction={reaction} talkLevel={talkLevel} followCursor={state !== "sleeping"} pointAtBoard={pointAtBoard} />
        </group>
        {classroom && <group position={[0.85, 0, -0.1]} rotation={[0, -0.3, 0]}><TeacherDesk prop={config.wardrobe.deskProp} /></group>}
        {mode === "workshop" && (
          <mesh material={robotMaterial("brushed_steel", "#b9bfc4")} position={[0, -0.04, 0]} receiveShadow><cylinderGeometry args={[1.05, 1.1, 0.08, 64]} /></mesh>
        )}
        {/* Shadow catcher: shows the robot's real cast shadow on an invisible floor. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, mode === "workshop" ? 0.001 : 0, 0]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <shadowMaterial transparent opacity={0.28} />
        </mesh>
        <ContactShadows position={[0, 0.002, 0]} opacity={0.5} scale={5} blur={2.4} far={2.5} />
        {/* Ambient occlusion darkens creases where parts meet (collars, joints, pockets); light bloom on LEDs and screens. */}
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <N8AO aoRadius={0.28} distanceFalloff={0.5} intensity={2.4} halfRes quality="medium" />
          <Bloom intensity={0.35} luminanceThreshold={0.92} luminanceSmoothing={0.1} mipmapBlur />
        </EffectComposer>
        <OrbitControls
          ref={controls}
          makeDefault
          enablePan={false}
          enableRotate={!classroom}
          enableZoom={!classroom}
          minDistance={1.6}
          maxDistance={7}
          minPolarAngle={0.35}
          maxPolarAngle={1.62}
          target={[0, height * 0.48, 0]}
        />
        {!classroom && <CameraRig focus={focus} height={height} controls={controls} />}
        <Snapshotter handle={snap} />
      </Suspense>
    </Canvas>
  );
}));
