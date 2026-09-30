"use client";
import { useState } from "react";
import { useI18n } from "@/lib/client/i18n";
import { PARTS, partName } from "@/lib/catalog";
import {
  BrassPlaque, Fader, FolderModal, GelButton, Knob, Lever, MetalButton, MetalToggle, RubberStamp, TubeProgress, VuGauge, materialSwatch,
} from "@/components/skeuo";
import { Conveyor } from "@/components/Conveyor";
import { WallClock, ClassWindow } from "@/components/ClassroomDecor";
import { toast } from "@/components/Toasts";

export default function StyleGuide() {
  const { lang, setLang, t, L, n } = useI18n();
  const [toggle, setToggle] = useState(true);
  const [fader, setFader] = useState(6);
  const [knob, setKnob] = useState(1);
  const [lever, setLever] = useState<"a" | "b" | "c">("b");
  const [modal, setModal] = useState(false);
  const [pct, setPct] = useState(45);
  const [drawer, setDrawer] = useState(true);
  const [paint, setPaint] = useState(PARTS.paint[0]);
  const [chip, setChip] = useState("brass");

  const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="paper" style={{ padding: 18, borderRadius: 8 }}>
      <h2 className="emboss" style={{ marginBottom: 12, fontSize: 22 }}>{title}</h2>
      {children}
    </section>
  );

  return (
    <main className="page stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="page-title emboss">{t("Style guide")}</h1>
        <MetalToggle checked={lang === "ar"} onChange={(v) => setLang(v ? "ar" : "en")} label={t("Arabic (right to left)")} />
      </div>

      <Sec title={t("Glossy buttons")}>
        <div className="row">
          {(["red", "green", "blue", "yellow", "purple", "orange", "teal"] as const).map((c) => <GelButton key={c} color={c}>{t(c)}</GelButton>)}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <GelButton size="xs">{t("Tiny")}</GelButton><GelButton size="sm">{t("Small")}</GelButton><GelButton>{t("Medium")}</GelButton><GelButton size="lg">{t("Large")}</GelButton><GelButton size="xl" color="red">{t("Huge")}</GelButton>
          <GelButton className="pressed" color="green">{t("Pressed")}</GelButton><GelButton disabled>{t("Disabled")}</GelButton>
          <MetalButton>{t("Metal")}</MetalButton><MetalButton active>{t("Metal pressed")}</MetalButton>
        </div>
      </Sec>

      <div className="two-col">
        <Sec title={t("Metal switch · Lever")}>
          <div className="stack">
            <MetalToggle checked={toggle} onChange={setToggle} label={toggle ? t("On") : t("Off")} />
            <Lever value={lever} onChange={setLever} options={[{ value: "a", label: t("Internet"), emoji: "🌐" }, { value: "b", label: t("Files"), emoji: "📚" }, { value: "c", label: t("Both"), emoji: "📚🌐" }]} />
          </div>
        </Sec>
        <Sec title={t("Fader · Knob")}>
          <div className="row" style={{ alignItems: "center", gap: 30 }}>
            <div className="grow"><Fader label={t("Humor")} value={fader} format={(v) => n(v)} onChange={setFader} /></div>
            <Knob label={t("Head size")} value={knob} min={0.7} max={1.5} step={0.05} onChange={setKnob} format={(v) => `${n(Math.round(v * 100))}٪`} />
          </div>
        </Sec>
      </div>

      <div className="two-col">
        <Sec title={t("Toolbox drawer · Part tiles")}>
          <div className="toolbox">
            <div className="drawer">
              <button className="drawer-front" onClick={() => setDrawer(!drawer)}>📺 {t("Head")}<span className="handle-bar" /></button>
              {drawer && <div className="drawer-body"><div className="part-grid">
                {["cube", "dome", "crt_tv", "capsule"].map((v, i) => <button key={v} className={`part-tile ${i === 2 ? "selected" : ""}`}><span style={{ fontSize: 26 }}>🤖</span>{L(partName(v))}</button>)}
              </div></div>}
            </div>
          </div>
        </Sec>
        <Sec title={t("Paint cans · Texture chips")}>
          <div className="paint-row">{PARTS.paint.map((c) => <button key={c} className={`paint-can ${paint === c ? "selected" : ""}`} style={{ ["--c" as string]: c }} onClick={() => setPaint(c)} aria-label={t("Paint colour")} />)}</div>
          <div className="chip-row" style={{ marginTop: 16 }}>{PARTS.materials.map((m) => <button key={m} className={`texture-chip ${chip === m ? "selected" : ""}`} onClick={() => setChip(m)}><span className="swatch" style={{ background: materialSwatch(m, paint) }} />{L(partName(m))}</button>)}</div>
        </Sec>
      </div>

      <div className="two-col">
        <Sec title={t("Rubber stamp · Sticky note · Index card")}>
          <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
            <RubberStamp>{t("Merged")}</RubberStamp><RubberStamp color="#2e7d4f" animate>{t("Approved")}</RubberStamp>
            <div className="citations"><button className="sticky-note">📕 {t("Biology 1 · p.142 · Mammals")}</button><button className="sticky-note">🌐 {t("Encyclopedia")}</button></div>
          </div>
          <div style={{ maxWidth: 260, marginTop: 20 }}>
            <button className="index-card"><h4>📇 {t("Mammals")}</h4>{t("Warm-blooded vertebrates with hair that feed their young with milk.")}<span className="rubber-stamp merge-stamp">{t("Merged ×{n}", { n: n(2) })}</span></button>
          </div>
        </Sec>
        <Sec title={t("Clipboard paper · Chalk text")}>
          <div className="clipboard"><div className="paper-sheet lined-paper">{t("Long answers are written on paper clipped to a clipboard, with a margin line and blue rules.")}</div></div>
          <div style={{ marginTop: 16 }}>
            <div className="chalkboard chalk-text" style={{ fontSize: 24 }}><div className="chalk-reveal">{t("Short answers go on the board!")}</div></div>
            <div className="chalk-tray" />
          </div>
        </Sec>
      </div>

      <div className="two-col">
        <Sec title={t("Analog gauge · Liquid tube · Brass plaque")}>
          <div className="row" style={{ alignItems: "center" }}>
            <div style={{ width: 260 }}><VuGauge used={pct * 40} baseline={200000} /></div>
            <div className="stack grow">
              <TubeProgress pct={pct} label={t("Reading… {pct}", { pct: `${n(pct)}٪` })} />
              <Fader label={t("Try it")} value={pct} min={0} max={100} format={(v) => n(v)} onChange={setPct} />
              <BrassPlaque value={n(1284330)} label={t("Tokens saved")} />
            </div>
          </div>
        </Sec>
        <Sec title={t("Conveyor steps · Clock · Window")}>
          <Conveyor id="demo" current={3} reached={3} />
          <div className="row" style={{ marginTop: 16, gap: 24 }}><WallClock /><ClassWindow /></div>
        </Sec>
      </div>

      <div className="two-col">
        <Sec title={t("Folder · Tape label · Pinned note")}>
          <div className="row">
            <GelButton onClick={() => setModal(true)}>{t("Open folder")}</GelButton>
            <MetalButton data-tip={t("I'm a tape label!")}>{t("Hover me")}</MetalButton>
            <GelButton color="yellow" onClick={() => toast(t("Pinned note 📌"))}>{t("Note")}</GelButton>
            <GelButton color="red" onClick={() => toast(t("Something went wrong"), "error")}>{t("Error note")}</GelButton>
          </div>
        </Sec>
        <Sec title={t("Stitched leather · Robot pod")}>
          <div className="row" style={{ alignItems: "stretch" }}>
            <div className="leather leather-panel stitched grow"><b className="deboss">{t("Stitched leather panel")}</b><p>{t("For side panels and modals.")}</p></div>
            <div className="robot-pod" style={{ width: 170, height: 240 }}><div /><div className="center" style={{ fontSize: 80, animation: "bob 3s infinite" }}>🤖</div><div className="pod-base brushed-metal"><div className="pod-name emboss">{t("Prof. Bolt")}</div></div></div>
          </div>
        </Sec>
      </div>

      <Sec title={t("Surfaces")}>
        <div className="row">
          {["wall", "wood", "cork", "brushed-metal", "slate", "felt", "leather", "manila", "kraft", "lined-paper", "grid-paper"].map((c) => (
            <div key={c} className={c} style={{ width: 120, height: 80, borderRadius: 8, display: "grid", placeItems: "center", fontWeight: 700, color: ["slate", "felt", "leather"].includes(c) ? "#fff" : "#222" }}>{t(c)}</div>
          ))}
        </div>
      </Sec>

      {modal && <FolderModal tab={t("Example folder")} onClose={() => setModal(false)}><h2 className="typewriter">{t("Paper slides out of a folder")}</h2><p>{t("Press Esc or ✕ to close.")}</p></FolderModal>}
    </main>
  );
}
