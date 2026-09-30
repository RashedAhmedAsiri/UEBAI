"use client";
import { useEffect, useRef } from "react";

/**
 * Test-chamber wall, painted once per viewport size on a fixed canvas behind the page:
 * large off-white concrete panels (some subdivided) with recessed seams, bevels, grime and
 * drips; a dark brushed-metal lower band with a glowing light strip; cool overhead lighting.
 * Also publishes a small tile as --wall-tile for framed walls inside pages (classroom).
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
}

/** Concrete texture: fine speckle + soft blotches, tileable-ish, grayscale with alpha. */
function concreteTexture(size: number, seed: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (r() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // soft low-frequency blotches
  for (let i = 0; i < 60; i++) {
    const x = r() * size, y = r() * size, rad = 10 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() > 0.5;
    grd.addColorStop(0, dark ? "rgba(70,70,70,.18)" : "rgba(200,200,200,.18)");
    grd.addColorStop(1, "rgba(128,128,128,0)");
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // pores
  for (let i = 0; i < size * 1.5; i++) {
    g.fillStyle = `rgba(40,40,40,${0.15 + r() * 0.25})`;
    g.beginPath();
    g.arc(r() * size, r() * size, 0.4 + r() * 1.1, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function brushedTexture(size: number, seed: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  g.fillStyle = "#808080";
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    const v = 128 + (r() - 0.5) * 36;
    g.fillStyle = `rgba(${v},${v},${v},.8)`;
    g.fillRect(0, y, size, 1);
  }
  for (let i = 0; i < size / 2; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},.05)`;
    g.fillRect(r() * size, r() * size, 20 + r() * 120, 1);
  }
  return c;
}

interface Opts { w: number; h: number; dpr: number; band: boolean; seed: number }

function drawPanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number, conc: CanvasPattern, s: number) {
  // Shadow cast into the seam (panel sits slightly proud of the wall).
  g.fillStyle = "rgba(0,0,0,.45)";
  g.fillRect(x + 1.5 * s, y + 2.5 * s, w, h);

  // Face: off-white with a faint cool tint and per-panel tone.
  const tone = 226 + Math.floor(r() * 16);
  const base = `rgb(${tone - 2},${tone + 2},${tone + 1})`;
  const grd = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  grd.addColorStop(0, `rgb(${tone + 8},${tone + 11},${tone + 10})`);
  grd.addColorStop(0.55, base);
  grd.addColorStop(1, `rgb(${tone - 12},${tone - 9},${tone - 9})`);
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);

  // Concrete texture (overlay-ish via multiply + screen passes).
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.translate(r() * 200, r() * 200);
  g.globalCompositeOperation = "multiply";
  g.globalAlpha = 0.22;
  g.fillStyle = conc;
  g.fillRect(x - 200, y - 200, w + 400, h + 400);
  g.globalCompositeOperation = "screen";
  g.globalAlpha = 0.1;
  g.fillRect(x - 200, y - 200, w + 400, h + 400);
  g.restore();

  // Grime: stains, drips from the top edge, scuffs near the bottom.
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  if (r() < 0.35) {
    const sx = x + r() * w, sy = y + r() * h, sr = (30 + r() * 90) * s;
    const st = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
    st.addColorStop(0, `rgba(110,100,82,${0.05 + r() * 0.07})`);
    st.addColorStop(1, "rgba(110,100,82,0)");
    g.fillStyle = st;
    g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  if (r() < 0.25) {
    const drips = 1 + Math.floor(r() * 4);
    for (let i = 0; i < drips; i++) {
      const dx = x + (0.1 + r() * 0.8) * w, len = (0.15 + r() * 0.5) * h, dw = (1 + r() * 2.5) * s;
      const dg = g.createLinearGradient(0, y, 0, y + len);
      dg.addColorStop(0, "rgba(90,82,70,.16)");
      dg.addColorStop(1, "rgba(90,82,70,0)");
      g.fillStyle = dg;
      g.fillRect(dx, y, dw, len);
    }
  }
  // Inner ambient occlusion along the edges.
  const ao = 10 * s;
  const edges: [number, number, number, number, number, number, number, number][] = [
    [x, y, x, y + ao, x, y, w, ao], [x, y + h, x, y + h - ao, x, y + h - ao, w, ao],
    [x, y, x + ao, y, x, y, ao, h], [x + w, y, x + w - ao, y, x + w - ao, y, ao, h],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
    const e = g.createLinearGradient(x0, y0, x1, y1);
    e.addColorStop(0, "rgba(0,0,0,.09)");
    e.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = e;
    g.fillRect(rx, ry, rw, rh);
  }
  g.restore();

  // Bevel: bright top/left lip, darker bottom/right lip.
  g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(x, y, w, 1.5 * s); g.fillRect(x, y, 1.5 * s, h);
  g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(x + 1.5 * s, y + 1.5 * s, w - 3 * s, 1.5 * s);
  g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(x, y + h - 1.5 * s, w, 1.5 * s); g.fillRect(x + w - 1.5 * s, y, 1.5 * s, h);
  g.fillStyle = "rgba(0,0,0,.08)"; g.fillRect(x + 1.5 * s, y + h - 3 * s, w - 3 * s, 1.5 * s);
}

function drawDarkPanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number, brushed: CanvasPattern, s: number) {
  g.fillStyle = "rgba(0,0,0,.6)";
  g.fillRect(x + 1 * s, y + 2 * s, w, h);
  const tone = 70 + Math.floor(r() * 12);
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, `rgb(${tone + 14},${tone + 18},${tone + 18})`);
  grd.addColorStop(1, `rgb(${tone - 10},${tone - 7},${tone - 7})`);
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalCompositeOperation = "overlay";
  g.globalAlpha = 0.45;
  g.fillStyle = brushed;
  g.fillRect(x, y, w, h);
  g.restore();
  g.fillStyle = "rgba(255,255,255,.22)"; g.fillRect(x, y, w, 1.2 * s);
  g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x, y + h - 1.2 * s, w, 1.2 * s);
  // Fasteners in the corners.
  for (const [fx, fy] of [[x + 9 * s, y + 9 * s], [x + w - 9 * s, y + 9 * s], [x + 9 * s, y + h - 9 * s], [x + w - 9 * s, y + h - 9 * s]]) {
    const fg = g.createRadialGradient(fx - 1 * s, fy - 1 * s, 0, fx, fy, 3.2 * s);
    fg.addColorStop(0, "#c9cfcf"); fg.addColorStop(0.6, "#5d6464"); fg.addColorStop(1, "#1d2121");
    g.fillStyle = fg;
    g.beginPath(); g.arc(fx, fy, 3.2 * s, 0, Math.PI * 2); g.fill();
  }
}

export function paintWall(canvas: HTMLCanvasElement, o: Opts) {
  const s = o.dpr;
  const W = Math.round(o.w * s), H = Math.round(o.h * s);
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d")!;
  const r = rng(o.seed);
  const conc = g.createPattern(concreteTexture(256, o.seed + 1), "repeat")!;
  const brushed = g.createPattern(brushedTexture(256, o.seed + 2), "repeat")!;

  // Seams (visible between panels): deep, dark, slightly cool.
  const seam = g.createLinearGradient(0, 0, 0, H);
  seam.addColorStop(0, "#343a39"); seam.addColorStop(1, "#262b2a");
  g.fillStyle = seam;
  g.fillRect(0, 0, W, H);

  const bandTop = o.band ? Math.round(H * 0.8) : H;
  const module = Math.round(Math.min(260, Math.max(170, o.h / 3.6)) * s);
  const gap = Math.max(4, Math.round(5 * s));
  const cols = Math.ceil(W / module) + 1;
  const rows = Math.ceil(bandTop / module) + 1;
  const ox = Math.round((W - cols * module) / 2);
  const oy = bandTop - rows * module; // grid lines up with the band

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = ox + col * module, y = oy + row * module;
      if (y + module < 0) continue;
      const roll = r();
      const parts: [number, number, number, number][] = roll < 0.66 ? [[0, 0, 1, 1]]
        : roll < 0.84 ? [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]
        : roll < 0.93 ? [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]
        : [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
      for (const [px, py, pw, ph] of parts) {
        const rx = x + px * module + gap / 2, ry = y + py * module + gap / 2;
        drawPanel(g, rx, ry, pw * module - gap, ph * module - gap, r, conc, s);
      }
    }
  }

  if (o.band) {
    // Dark non-reflective band along the bottom.
    const dm = Math.round(module * 0.75);
    const dcols = Math.ceil(W / dm) + 1;
    const dh = H - bandTop;
    g.fillStyle = "#151818";
    g.fillRect(0, bandTop, W, dh);
    for (let col = 0; col < dcols; col++) {
      drawDarkPanel(g, ox + col * dm + gap / 2, bandTop + gap * 2, dm - gap, dh - gap * 2, r, brushed, s);
    }
    // Light strip between the two surfaces.
    g.save();
    g.shadowColor = "rgba(170,235,255,.9)";
    g.shadowBlur = 22 * s;
    const lg = g.createLinearGradient(0, bandTop - 3 * s, 0, bandTop + 5 * s);
    lg.addColorStop(0, "#dff8ff"); lg.addColorStop(0.5, "#ffffff"); lg.addColorStop(1, "#bfefff");
    g.fillStyle = lg;
    g.fillRect(0, bandTop - 2 * s, W, 6 * s);
    g.restore();
    const glow = g.createLinearGradient(0, bandTop - 90 * s, 0, bandTop);
    glow.addColorStop(0, "rgba(190,240,255,0)"); glow.addColorStop(1, "rgba(190,240,255,.18)");
    g.fillStyle = glow;
    g.fillRect(0, bandTop - 90 * s, W, 90 * s);
  }

  // Cold overhead light + vignette.
  const light = g.createRadialGradient(W * 0.5, -H * 0.15, 0, W * 0.5, -H * 0.15, Math.max(W, H) * 1.05);
  light.addColorStop(0, "rgba(255,255,255,.22)");
  light.addColorStop(0.45, "rgba(255,255,255,0)");
  light.addColorStop(1, "rgba(8,18,20,.32)");
  g.fillStyle = light;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(200,232,240,.05)";
  g.fillRect(0, 0, W, H);
}

/** Small tile (2×2 panels) for framed walls inside pages. */
function tileDataUrl(seed: number) {
  const c = document.createElement("canvas");
  const size = 360;
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  const conc = g.createPattern(concreteTexture(256, seed + 1), "repeat")!;
  g.fillStyle = "#303635";
  g.fillRect(0, 0, size, size);
  const m = size / 2, gap = 4;
  for (let i = 0; i < 4; i++) drawPanel(g, (i % 2) * m + gap / 2, Math.floor(i / 2) * m + gap / 2, m - gap, m - gap, r, conc, 1);
  return c.toDataURL("image/jpeg", 0.9);
}

export function WallBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const paint = () => paintWall(canvas, { w: window.innerWidth, h: window.innerHeight, dpr: Math.min(2, window.devicePixelRatio || 1), band: true, seed: 7 });
    paint();
    try { document.documentElement.style.setProperty("--wall-tile", `url(${tileDataUrl(11)})`); } catch { /* ignore */ }
    const onResize = () => { if (timer) clearTimeout(timer); timer = setTimeout(paint, 180); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); if (timer) clearTimeout(timer); };
  }, []);
  return <canvas ref={ref} className="wall-canvas" aria-hidden />;
}
