"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTeacher } from "@/lib/client/useTeacher";
import { useI18n } from "@/lib/client/i18n";
import { api } from "@/lib/client/api";
import { play } from "@/lib/client/sound";
import {
  BODY_SLOTS, ITEMS, PARTS, THEME_PACKS, WARDROBE_SLOTS, defaultRobot, itemSlotFor, matchThemePack, partName, randomRobot, type WardrobeSlot,
} from "@/lib/catalog";
import type { BodySlot, RobotConfig } from "@/lib/schemas";
import { Conveyor } from "@/components/Conveyor";
import { RobotStage, type Focus, type RobotStageHandle } from "@/components/robot/RobotStage";
import type { Reaction } from "@/components/robot/Robot";
import { Fader, GelButton, Knob, MetalButton, materialSwatch } from "@/components/skeuo";
import { toast } from "@/components/Toasts";

const ICON: Record<string, string> = {
  cube: "🟦", dome: "🔵", crt_tv: "📺", capsule: "💊", tin_can: "🥫", lightbulb: "💡", saucer: "🛸", radio: "📻",
  single_ball: "🔴", twin_balls: "🎈", dish: "📡", propeller: "🌀", lightning_rod: "⚡", none: "🚫",
  bolts: "🔩", headphones: "🎧", radar: "📡",
  barrel: "🛢️", box: "📦", oval: "🥚", vending: "🥤", boiler: "♨️",
  dials: "🎛️", gauge: "⏲️", tape_reels: "📼", heart: "❤️", keypad: "🔢", blank: "⬜",
  tubes: "🧪", springs: "➰", pistons: "🔧", noodle: "🍜",
  claws: "🦀", mitts: "🧤", grippers: "🦾", suction: "🪠",
  legs: "🦿", wheel: "🛞", treads: "🚜", hover: "🛸", pogo: "🦘",
  pixel_dots: "👾", ovals: "👀", visor: "🕶️", anime: "✨", glasses: "👓", cyclops: "🧿",
  line: "➖", grille: "🎚️", equalizer: "📊",
};
const ITEM_ICON: Record<string, string> = {
  top: "👔", neck: "🎀", headwear: "🎩", eyewear: "👓", hand: "✋", back: "🎒", badge: "📛", desk: "🗄️",
};

type Slot = BodySlot | "face" | "proportions";
const focusFor = (s: Slot | WardrobeSlot): Focus =>
  ["head", "antenna", "ears", "face", "headwear", "eyewear"].includes(s) ? "head"
    : ["arms", "hands", "leftHand", "rightHand"].includes(s) ? "arms"
    : s === "base" ? "base" : s === "proportions" || s === "deskProp" ? "all" : "body";

export default function WorkshopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const router = useRouter();
  const tab = search.get("tab") === "dress" ? "dress" : "build";
  const { t, tm, L } = useI18n();
  const { teacher, patch, flush } = useTeacher(id);
  const stage = useRef<RobotStageHandle>(null);

  const [hist, setHist] = useState<{ past: RobotConfig[]; present: RobotConfig | null; future: RobotConfig[] }>({ past: [], present: null, future: [] });
  const [slot, setSlot] = useState<Slot>("head");
  const [wslot, setWslot] = useState<WardrobeSlot>("top");
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [subjectInput, setSubjectInput] = useState("");
  const [dressing, setDressing] = useState(false);
  const react = (kind: Reaction["kind"]) => setReaction({ kind, n: Date.now() });

  useEffect(() => {
    if (teacher && !hist.present) {
      setHist({ past: [], present: teacher.robot_config, future: [] });
      setSubjectInput(teacher.subject.name);
    }
  }, [teacher, hist.present]);

  const cfg = hist.present;
  const commit = useCallback((next: RobotConfig) => {
    setHist((h) => ({ past: [...h.past.slice(-49), h.present!], present: next, future: [] }));
    void patch({ robot_config: next });
  }, [patch]);

  const undo = () => setHist((h) => {
    if (!h.past.length) return h;
    const prev = h.past[h.past.length - 1];
    void patch({ robot_config: prev });
    return { past: h.past.slice(0, -1), present: prev, future: [h.present!, ...h.future] };
  });
  const redo = () => setHist((h) => {
    if (!h.future.length) return h;
    const next = h.future[0];
    void patch({ robot_config: next });
    return { past: [...h.past, h.present!], present: next, future: h.future.slice(1) };
  });

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const setPart = (s: BodySlot, p: Partial<RobotConfig["body"]["head"]>) => {
    if (!cfg) return;
    commit({ ...cfg, body: { ...cfg.body, [s]: { ...cfg.body[s], ...p } } });
    if (p.variant) react(s === "head" ? "blink" : "ooh");
    if (p.tint || p.material) react("ooh");
  };

  const setWear = (ws: WardrobeSlot, id: string | null) => {
    if (!cfg) return;
    const w = { ...cfg.wardrobe };
    if (ws === "badges") {
      if (!id) w.badges = [];
      else w.badges = w.badges.includes(id) ? w.badges.filter((b) => b !== id) : [...w.badges, id].slice(-3);
    } else (w[ws] as string | null) = id;
    commit({ ...cfg, wardrobe: w });
    react(ws === "headwear" ? "look_up" : "happy");
  };

  const dressForSubject = async () => {
    const subject = subjectInput.trim() || teacher?.subject.name || "";
    if (!subject) { toast(t("Type a subject first (e.g. Biology)"), "error"); return; }
    setDressing(true);
    try {
      const d = await api<{ wardrobe: RobotConfig["wardrobe"]; pack: string | null; source: string }>(`/api/teachers/${id}/suggest-outfit`, { method: "POST", json: { subject } });
      if (cfg) commit({ ...cfg, wardrobe: d.wardrobe });
      if (teacher && !teacher.subject.name) void patch({ subject: { ...teacher.subject, name: subject } });
      react("dance");
      play("happy");
      toast(d.pack ? t("Dressed with the {pack} theme pack!", { pack: L(THEME_PACKS[d.pack].name) }) : t("Outfit picked for your subject!"));
    } catch (e) { toast(tm((e as Error).message), "error"); }
    finally { setDressing(false); }
  };

  const save = async (goNext?: boolean) => {
    const png = stage.current?.snapshot();
    await patch({ ...(png ? { avatar_url: png } : {}), ...(teacher?.draft ? { wizard_step: tab === "build" ? 2 : 3 } : {}) }, true);
    await flush();
    play("stamp");
    if (!goNext) { toast(t("Saved to the robot's memory chip 💾")); return; }
    router.push(tab === "build" ? `/workshop/${id}?tab=dress` : `/personality/${id}`);
  };

  const pack = useMemo(() => matchThemePack(subjectInput || teacher?.subject.name || ""), [subjectInput, teacher?.subject.name]);
  const packIds = useMemo(() => new Set(pack ? Object.values(THEME_PACKS[pack].outfit).flat().filter(Boolean) as string[] : []), [pack]);

  if (!teacher || !cfg) return <main className="page"><p className="hand center">{t("Opening the workshop…")}</p></main>;

  const bodyPart = slot !== "face" && slot !== "proportions" ? cfg.body[slot] : null;
  const focus = tab === "build" ? focusFor(slot) : focusFor(wslot);
  const name = L;

  return (
    <main className="page">
      {teacher.draft && <Conveyor id={id} current={tab === "build" ? 1 : 2} reached={teacher.wizard_step} />}
      <div className="row" style={{ justifyContent: "space-between", margin: "14px 0 8px" }}>
        <h1 className="page-title emboss" style={{ margin: 0 }}>{tab === "build" ? t("Workshop") : t("Wardrobe")}: {teacher.title} {teacher.name}</h1>
        <div className="row">
          <MetalButton active={tab === "build"} onClick={() => router.replace(`/workshop/${id}?tab=build`)}>🔧 {t("Build")}</MetalButton>
          <MetalButton active={tab === "dress"} onClick={() => router.replace(`/workshop/${id}?tab=dress`)}>👔 {t("Dress")}</MetalButton>
          {!teacher.draft && <MetalButton onClick={() => router.push(`/classroom/${id}`)}>🏫 {t("Classroom")}</MetalButton>}
        </div>
      </div>

      <div className="workshop">
        {/* LEFT: toolbox drawers */}
        <aside className="toolbox" aria-label={t("Toolbox")}>
          {tab === "build" ? (
            [...BODY_SLOTS.slice(0, 1), "face" as const, ...BODY_SLOTS.slice(1), "proportions" as const].map((s) => (
              <div className="drawer" key={s}>
                <button className="drawer-front" onClick={() => { play("drawer"); setSlot(s); }} aria-expanded={slot === s}>
                  {s === "face" ? `🙂 ${t("Face")}` : s === "proportions" ? `📏 ${t("Proportions")}` : `${ICON[cfg.body[s].variant] ?? "⚙️"} ${name(PARTS.slots[s].name)}`}
                  <span className="handle-bar" />
                </button>
                {slot === s && s !== "proportions" && (
                  <div className="drawer-body">
                    {s === "face" ? (
                      <div className="stack">
                        <div className="field-label" style={{ color: "#ddd" }}>{t("Eyes")}</div>
                        <div className="part-grid">{PARTS.face.eyes.map((v) => (
                          <button key={v} className={`part-tile ${cfg.body.face.eyes === v ? "selected" : ""}`} onClick={() => { play("click"); commit({ ...cfg, body: { ...cfg.body, face: { ...cfg.body.face, eyes: v } } }); react("blink"); }}>
                            <span style={{ fontSize: 26 }}>{ICON[v]}</span>{L(partName(v))}</button>))}</div>
                        <div className="field-label" style={{ color: "#ddd" }}>{t("Mouth")}</div>
                        <div className="part-grid">{PARTS.face.mouth.map((v) => (
                          <button key={v} className={`part-tile ${cfg.body.face.mouth === v ? "selected" : ""}`} onClick={() => { play("click"); commit({ ...cfg, body: { ...cfg.body, face: { ...cfg.body.face, mouth: v } } }); react("happy"); }}>
                            <span style={{ fontSize: 26 }}>{ICON[v]}</span>{L(partName(v))}</button>))}</div>
                      </div>
                    ) : (
                      <div className="part-grid">{PARTS.slots[s].variants.map((v) => (
                        <button key={v} className={`part-tile ${cfg.body[s].variant === v ? "selected" : ""}`} onClick={() => { play("click"); setPart(s, { variant: v }); }}>
                          <span style={{ fontSize: 28 }}>{ICON[v] ?? "⚙️"}</span>{L(partName(v))}</button>))}</div>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            WARDROBE_SLOTS.map((ws) => {
              const itemSlot = itemSlotFor(ws);
              const items = ITEMS.filter((i) => i.slot === itemSlot);
              const labels: Record<WardrobeSlot, string> = { top: "Top", neck: "Neck", headwear: "Headwear", eyewear: "Eyewear", leftHand: "Left hand", rightHand: "Right hand", back: "Back item", badges: "Badges", deskProp: "Desk prop" };
              const cur = ws === "badges" ? cfg.wardrobe.badges : [cfg.wardrobe[ws]];
              return (
                <div className="drawer" key={ws}>
                  <button className="drawer-front" onClick={() => { play("drawer"); setWslot(ws); }} aria-expanded={wslot === ws}>
                    {ITEM_ICON[itemSlot]} {t(labels[ws])}
                    <span style={{ fontSize: 12, opacity: .85 }}>{ws === "badges" ? `${cfg.wardrobe.badges.length}/3` : cur[0] ? "✓" : ""}</span>
                    <span className="handle-bar" />
                  </button>
                  {wslot === ws && (
                    <div className="drawer-body">
                      <div className="part-grid">
                        <button className={`part-tile ${!cur.filter(Boolean).length ? "selected" : ""}`} onClick={() => { play("click"); setWear(ws, null); }}><span style={{ fontSize: 26 }}>🚫</span>{t("None")}</button>
                        {items.map((it) => (
                          <button key={it.id} className={`part-tile ${cur.includes(it.id) ? "selected" : ""}`} onClick={() => { play("click"); setWear(ws, it.id); }} title={name(it.name)}>
                            {packIds.has(it.id) && <span style={{ position: "absolute", top: 2, insetInlineEnd: 4 }} title={t("Matches your subject")}>⭐</span>}
                            <span style={{ width: 30, height: 30, borderRadius: 6, background: it.color, boxShadow: "inset 0 -3px 5px #0004, 0 1px 2px #0006", display: "grid", placeItems: "center", fontSize: 16 }}>{it.symbol ?? ""}</span>
                            {name(it.name)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </aside>

        {/* CENTER: turntable */}
        <section className="workbench wood">
          <div className="toolbar">
            <GelButton color="purple" size="sm" onClick={() => { commit(randomRobot(cfg.wardrobe)); react("dizzy"); }}>🎲 {t("Randomize")}</GelButton>
            <GelButton color="yellow" size="sm" onClick={undo} disabled={!hist.past.length}>↶ {t("Undo")}</GelButton>
            <GelButton color="yellow" size="sm" onClick={redo} disabled={!hist.future.length}>↷ {t("Redo")}</GelButton>
            <GelButton color="red" size="sm" onClick={() => { commit(tab === "build" ? { ...defaultRobot(), wardrobe: cfg.wardrobe } : { ...cfg, wardrobe: defaultRobot().wardrobe }); react("blink"); }}>⟲ {t("Reset")}</GelButton>
            <GelButton color="teal" size="sm" onClick={dressForSubject} disabled={dressing}>👔 {dressing ? "…" : t("Dress for my subject")}</GelButton>
            <GelButton color="blue" size="sm" sound="stamp" onClick={() => save(false)}>💾 {t("Save")}</GelButton>
          </div>
          <div className="stage">
            <RobotStage ref={stage} config={cfg} reaction={reaction} focus={focus} fallbackImage={teacher.avatar_url} />
          </div>
        </section>

        {/* RIGHT: paint, materials, sliders */}
        <aside className="side-panel brushed-metal rivets">
          {tab === "build" && bodyPart && slot !== "chest" && (
            <>
              <div>
                <div className="panel-title emboss">🎨 {t("Paint")} — {name(PARTS.slots[slot as BodySlot].name)}</div>
                <div className="paint-row">
                  {PARTS.paint.map((c) => (
                    <button key={c} className={`paint-can ${bodyPart.tint === c ? "selected" : ""}`} style={{ ["--c" as string]: c }} aria-label={t("Paint colour")} onClick={() => { play("pop"); setPart(slot as BodySlot, { tint: c }); }} />
                  ))}
                  <label className="paint-can color-input-can" style={{ ["--c" as string]: bodyPart.tint ?? "#ffffff" }} data-tip={t("Custom colour")}>
                    <input type="color" value={bodyPart.tint ?? "#ffffff"} onChange={(e) => setPart(slot as BodySlot, { tint: e.target.value.toUpperCase() })} />
                  </label>
                </div>
              </div>
              <div>
                <div className="panel-title emboss">🧱 {t("Material")}</div>
                <div className="chip-row">
                  {PARTS.materials.map((m) => (
                    <button key={m} className={`texture-chip ${bodyPart.material === m ? "selected" : ""}`} onClick={() => { play("click"); setPart(slot as BodySlot, { material: m }); }}>
                      <span className="swatch" style={{ background: materialSwatch(m, bodyPart.tint) }} />{L(partName(m))}
                    </button>
                  ))}
                </div>
              </div>
              <Fader label={t("Wear & rust")} value={Math.round((bodyPart.wear ?? 0) * 10)} onChange={(v) => setPart(slot as BodySlot, { wear: v / 10 })} />
            </>
          )}
          {tab === "build" && slot === "face" && (
            <div>
              <div className="panel-title emboss">🖥️ {t("Screen color")}</div>
              <div className="paint-row">
                {PARTS.face.screenColors.map((c) => (
                  <button key={c} className={`paint-can ${cfg.body.face.screenColor === c ? "selected" : ""}`} style={{ ["--c" as string]: c }} aria-label={t("Screen color")}
                    onClick={() => { play("pop"); commit({ ...cfg, body: { ...cfg.body, face: { ...cfg.body.face, screenColor: c } } }); react("ooh"); }} />
                ))}
              </div>
            </div>
          )}
          {tab === "build" && slot === "chest" && <p className="hand">{t("The chest panel is a little dashboard — pick one from the drawer. It blinks when the robot thinks!")}</p>}
          {tab === "build" && (
            <div>
              <div className="panel-title emboss">📏 {t("Proportions")}</div>
              <div className="row" style={{ justifyContent: "space-around" }}>
                {([["height", "Height"], ["width", "Width"], ["headSize", "Head size"], ["armLength", "Arm length"]] as const).map(([k, label]) => (
                  <Knob key={k} label={t(label)} value={cfg.body.proportions[k]} min={k === "armLength" ? 0.6 : 0.7} max={k === "headSize" ? 1.5 : 1.35} step={0.05}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setHist((h) => {
                      const next = { ...h.present!, body: { ...h.present!.body, proportions: { ...h.present!.body.proportions, [k]: v } } };
                      void patch({ robot_config: next });
                      return { ...h, present: next };
                    })} />
                ))}
              </div>
            </div>
          )}
          {tab === "dress" && (
            <div className="stack">
              <div className="panel-title emboss">📚 {t("Subject")}</div>
              <input className="typed-input" style={{ background: "#fffdf5", padding: 8, borderRadius: 4 }} placeholder={t("e.g. Biology, Math, History")} value={subjectInput} onChange={(e) => setSubjectInput(e.target.value)} />
              {pack ? <p className="hand">⭐ {t("Theme pack")}: <b>{name(THEME_PACKS[pack].name)}</b> — {t("starred items match.")}</p> : subjectInput && <p className="hand">{t("No theme pack — “Dress for my subject” will ask the AI to pick from the catalog.")}</p>}
              <GelButton color="teal" onClick={dressForSubject} disabled={dressing}>👔 {t("Dress for my subject")}</GelButton>
              <div className="panel-title emboss" style={{ marginTop: 8 }}>🧵 {t("Theme packs")}</div>
              <div className="row">{Object.entries(THEME_PACKS).map(([pid, p]) => (
                <button key={pid} className="metal-button" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => { commit({ ...cfg, wardrobe: p.outfit }); react("dance"); setSubjectInput(L(p.name)); }}>{name(p.name)}</button>
              ))}</div>
            </div>
          )}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
            {teacher.draft && tab === "build" && <GelButton color="orange" size="sm" onClick={() => router.push(`/personality/${id}`)}>{t("Skip dressing")}</GelButton>}
            {teacher.draft && <GelButton color="green" onClick={() => save(true)}>{t("Next →")}</GelButton>}
          </div>
        </aside>
      </div>
    </main>
  );
}
