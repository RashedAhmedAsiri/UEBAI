"use client";
import * as THREE from "three";
import type { RobotState } from "@/lib/types";

/** The robot's face is a CanvasTexture: 2D expressions drawn every frame with scanlines + glow. */
export class FaceScreen {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private w = 256;
  private h = 192;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  draw(opts: { state: RobotState; eyes: string; mouth: string; color: string; t: number; blink: boolean; look: { x: number; y: number }; talk: number }) {
    const { ctx, w, h } = this;
    const { state, color, t } = opts;
    ctx.fillStyle = "#050807";
    ctx.fillRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    bg.addColorStop(0, hexA(color, 0.12));
    bg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";

    if (state === "booting") {
      // static + flicker
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 180 * (0.5 + 0.5 * Math.sin(t * 30));
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
      ctx.restore();
      this.scanlines();
      this.texture.needsUpdate = true;
      return;
    }

    const lx = opts.look.x * 14, ly = opts.look.y * 10 + (state === "listening" ? 8 : 0);
    const eyeY = h * 0.42 + ly, gap = 52;
    const closed = opts.blink || state === "sleeping";
    this.drawEyes(opts.eyes, state, w / 2 + lx, eyeY, gap, closed, t);
    this.drawMouth(opts.mouth, state, w / 2 + lx * 0.5, h * 0.76 + ly * 0.4, opts.talk, t);

    if (state === "thinking") {
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(w - 34 + Math.cos(a) * 12, 30 + Math.sin(a) * 12, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (state === "sleeping") {
      ctx.font = "bold 22px monospace";
      const z = (t * 0.8) % 1;
      ctx.globalAlpha = 1 - z;
      ctx.fillText("z", w - 50 + z * 10, 50 - z * 26);
      ctx.fillText("Z", w - 34 + z * 12, 34 - z * 20);
      ctx.globalAlpha = 1;
    }
    if (state === "confused") {
      ctx.font = "bold 34px monospace";
      ctx.fillText("?", w - 38, 44);
    }
    ctx.restore();
    this.scanlines();
    this.texture.needsUpdate = true;
  }

  private drawEyes(style: string, state: RobotState, cx: number, cy: number, gap: number, closed: boolean, t: number) {
    const ctx = this.ctx;
    const happy = state === "happy" || state === "proud";
    const surprised = state === "surprised";
    const pos = style === "cyclops" ? [cx] : [cx - gap, cx + gap];
    for (const x of pos) {
      if (closed) { ctx.beginPath(); ctx.moveTo(x - 18, cy); ctx.lineTo(x + 18, cy); ctx.stroke(); continue; }
      if (happy) { ctx.beginPath(); ctx.arc(x, cy + 8, 18, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); continue; }
      const s = surprised ? 1.35 : 1;
      switch (style) {
        case "pixel_dots": {
          const p = 7 * s;
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (Math.abs(i) + Math.abs(j) < 2) ctx.fillRect(x + i * p * 1.3 - p / 2, cy + j * p * 1.3 - p / 2, p, p);
          break;
        }
        case "visor": {
          ctx.fillRect(cx - gap - 26, cy - 9 * s, gap * 2 + 52, 18 * s);
          const sweep = cx + Math.sin(t * 2.2) * (gap + 10);
          ctx.fillStyle = "#fff"; ctx.fillRect(sweep - 8, cy - 7 * s, 16, 14 * s); ctx.fillStyle = this.ctx.strokeStyle as string;
          return;
        }
        case "anime": {
          ctx.beginPath(); ctx.ellipse(x, cy, 17 * s, 24 * s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#050807"; ctx.beginPath(); ctx.ellipse(x + 2, cy + 3, 9 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x - 5, cy - 9, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + 5, cy + 6, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = ctx.strokeStyle as string;
          break;
        }
        case "glasses": {
          ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, cy, 22, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, cy, 8 * s, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 8;
          if (x > cx) { ctx.beginPath(); ctx.moveTo(cx - gap + 22, cy - 4); ctx.lineTo(cx + gap - 22, cy - 4); ctx.lineWidth = 4; ctx.stroke(); ctx.lineWidth = 8; }
          break;
        }
        case "cyclops": {
          ctx.beginPath(); ctx.arc(x, cy, 30 * s, 0, Math.PI * 2); ctx.lineWidth = 6; ctx.stroke();
          ctx.beginPath(); ctx.arc(x, cy, 13 * s, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 8;
          break;
        }
        default: { // ovals
          ctx.beginPath(); ctx.ellipse(x, cy, 13 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (state === "confused" && x > cx) { ctx.beginPath(); ctx.moveTo(x - 16, cy - 30); ctx.lineTo(x + 16, cy - 24); ctx.stroke(); }
    }
  }

  private drawMouth(style: string, state: RobotState, cx: number, cy: number, talk: number, t: number) {
    const ctx = this.ctx;
    const talking = state === "talking";
    if (state === "happy" || state === "proud") {
      ctx.beginPath(); ctx.arc(cx, cy - 16, 26, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); return;
    }
    if (state === "surprised") { ctx.beginPath(); ctx.ellipse(cx, cy, 10, 14, 0, 0, Math.PI * 2); ctx.stroke(); return; }
    switch (style) {
      case "none": return;
      case "equalizer": {
        for (let i = -3; i <= 3; i++) {
          const amp = talking ? (0.3 + talk * 0.7) * (0.5 + 0.5 * Math.abs(Math.sin(t * 13 + i * 1.7))) : 0.12;
          const bh = 6 + amp * 30;
          ctx.fillRect(cx + i * 12 - 4, cy - bh / 2, 8, bh);
        }
        return;
      }
      case "grille": {
        ctx.lineWidth = 3;
        const open = talking ? 0.4 + talk * 0.6 * Math.abs(Math.sin(t * 14)) : 0.25;
        ctx.strokeRect(cx - 34, cy - 12 * open - 4, 68, 24 * open + 8);
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 12, cy - 12 * open - 4); ctx.lineTo(cx + i * 12, cy + 12 * open + 4); ctx.stroke(); }
        ctx.lineWidth = 8;
        return;
      }
      default: { // line
        if (talking) { const o = 4 + talk * 16 * Math.abs(Math.sin(t * 15)); ctx.beginPath(); ctx.ellipse(cx, cy, 22, o, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (state === "confused") { ctx.beginPath(); ctx.moveTo(cx - 22, cy + 4); ctx.quadraticCurveTo(cx - 8, cy - 8, cx + 4, cy + 2); ctx.quadraticCurveTo(cx + 14, cy + 10, cx + 24, cy - 2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(cx - 24, cy); ctx.lineTo(cx + 24, cy); ctx.stroke(); }
      }
    }
  }

  private scanlines() {
    const { ctx, w, h } = this;
    ctx.fillStyle = "rgba(0,0,0,.28)";
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  dispose() { this.texture.dispose(); }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
