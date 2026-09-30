"use client";
import * as THREE from "three";

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private radius: number, private height: number, private turns: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a) * this.radius, -t * this.height, Math.sin(a) * this.radius);
  }
}

const cache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = cache.get(key) as T | undefined;
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

export const helix = (radius: number, height: number, turns: number, tube = 0.025) =>
  cached(`helix:${radius}:${height}:${turns}:${tube}`, () => new THREE.TubeGeometry(new HelixCurve(radius, height, turns), Math.round(turns * 24), tube, 8, false));

export const noodle = (length: number, bend: number, tube = 0.06) =>
  cached(`noodle:${length}:${bend}:${tube}`, () => new THREE.TubeGeometry(
    new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(bend, -length * 0.33, 0.05), new THREE.Vector3(-bend * 0.6, -length * 0.66, -0.05), new THREE.Vector3(0, -length, 0)),
    24, tube, 10, false));

export const heartShape = () => cached("heart", () => {
  const s = new THREE.Shape();
  s.moveTo(0, -0.06);
  s.bezierCurveTo(0.09, 0.01, 0.07, 0.08, 0, 0.045);
  s.bezierCurveTo(-0.07, 0.08, -0.09, 0.01, 0, -0.06);
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3 });
});

export const halfDisc = (r: number) => cached(`halfdisc:${r}`, () => new THREE.CircleGeometry(r, 32, 0, Math.PI));

export const capeGeometry = () => cached("cape", () => {
  const g = new THREE.CylinderGeometry(0.46, 0.62, 1.0, 24, 6, true, Math.PI * 0.65, Math.PI * 0.7);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setZ(i, pos.getZ(i) + Math.sin(pos.getX(i) * 9) * 0.02 * (0.5 - y));
  }
  g.computeVertexNormals();
  return g;
});

/** Canvas texture with a symbol (badge faces, calculator screen, etc.). */
const textCache = new Map<string, THREE.CanvasTexture>();
export function symbolTexture(symbol: string, bg: string, fg = "#fff") {
  const key = `${symbol}|${bg}|${fg}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(48, 40, 10, 64, 64, 70);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.15, bg);
  g.addColorStop(1, bg);
  x.fillStyle = g;
  x.beginPath(); x.arc(64, 64, 64, 0, Math.PI * 2); x.fill();
  x.fillStyle = fg;
  x.font = `bold ${symbol.length > 2 ? 44 : 70}px sans-serif`;
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(symbol, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textCache.set(key, t);
  return t;
}
