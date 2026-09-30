import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildShemagh } from "@/components/robot/shemagh";
import { HEAD_SPEC, EAR_SPEC } from "@/components/robot/parts";
import { SECTIONS, neckGap, sectionFor, type GarmentShape } from "@/components/robot/garments";
import type { WearCtx } from "@/components/robot/wardrobe";
import { templateSetup } from "@/lib/templates";
import { ITEM_BY_ID, THEME_PACKS } from "@/lib/catalog";
import { PersonalitySchema, RobotConfigSchema } from "@/lib/schemas";

const THOBE: Omit<GarmentShape, "h"> = { drop: 0.38, flare: 0.06 };

function ctxFor(head: string, torso: string, hs = 1.05): WearCtx {
  const spec = HEAD_SPEC[head];
  return {
    torsoH: 0.9, torsoVariant: torso, chestVisible: false,
    headW: spec.w, headH: spec.h, headD: 2 * (spec.front - 0.04), headTop: spec.top, headBottom: spec.bottom, headFront: spec.front, screen: spec.screen,
    hat: spec.hat, earTop: EAR_SPEC.bolts.top, earOut: EAR_SPEC.bolts.out,
    headVariant: head, body: { hs, gap: neckGap(sectionFor(torso)), W: 1, D: 1 },
  };
}

function positions(g: THREE.BufferGeometry) {
  const a = g.getAttribute("position");
  return Array.from({ length: a.count }, (_, i) => new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)));
}

describe("shemagh", () => {
  for (const head of Object.keys(HEAD_SPEC)) {
    for (const torso of Object.keys(SECTIONS)) {
      it(`fits a ${head} head on a ${torso} torso`, () => {
        const ctx = ctxFor(head, torso);
        const sec = sectionFor(torso);
        const parts = buildShemagh(ctx, sec, { h: ctx.torsoH, ...THOBE });
        const spec = HEAD_SPEC[head];
        const [sw, sh] = spec.screen;
        const cloth = [parts.cap, parts.band, parts.drape].flatMap(positions);
        // No NaN/∞ anywhere.
        for (const g of [parts.cap, parts.band, parts.drape, parts.hem, parts.fold, ...parts.agal]) {
          for (const p of positions(g)) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        }
        for (const p of cloth) {
          const y = p.y + spec.top; // head_top-local → head-local
          // Never inside the face screen's bezel box.
          const inBezel = Math.abs(p.x) < (sw + 0.08) / 2 && Math.abs(y) < (sh + 0.08) / 2 && p.z > spec.front - 0.1;
          expect(inBezel, `cloth over the screen at ${p.toArray().map((v) => v.toFixed(3))}`).toBe(false);
        }
        // Covers the crown, stays level, and hangs below the head onto the shoulders.
        const ys = cloth.map((p) => p.y + spec.top);
        expect(Math.max(...ys)).toBeGreaterThan(spec.top);
        expect(Math.min(...ys)).toBeLessThan(spec.bottom - 0.1);
      });
    }
  }
});

describe("Saudi history template", () => {
  it("is a valid, fully dressed teacher", () => {
    const t = templateSetup("saudi_history");
    expect(RobotConfigSchema.safeParse(t.robot_config).success).toBe(true);
    expect(PersonalitySchema.safeParse(t.personality).success).toBe(true);
    expect(t.robot_config.wardrobe.top).toBe("thobe_coat");
    expect(t.robot_config.wardrobe.headwear).toBe("shemagh");
    expect(ITEM_BY_ID.get("shemagh")?.builder).toBe("shemagh");
    expect(THEME_PACKS.saudi_history.outfit.headwear).toBe("shemagh");
    expect(t.personality.voice.enabled).toBe(true);
  });
});
