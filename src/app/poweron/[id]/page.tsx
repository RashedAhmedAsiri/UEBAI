"use client";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTeacher } from "@/lib/client/useTeacher";
import { useI18n } from "@/lib/client/i18n";
import { api } from "@/lib/client/api";
import { play } from "@/lib/client/sound";
import { speak } from "@/lib/client/tts";
import type { RobotState } from "@/lib/types";
import { Conveyor } from "@/components/Conveyor";
import { RobotStage, type RobotStageHandle } from "@/components/robot/RobotStage";
import type { Reaction } from "@/components/robot/Robot";
import { GelButton } from "@/components/skeuo";

export default function PowerOn({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useI18n();
  const { teacher, patch, flush } = useTeacher(id);
  const [phase, setPhase] = useState<"off" | "booting" | "on">("off");
  const [state, setState] = useState<RobotState>("sleeping");
  const [line, setLine] = useState<string | null>(null);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const stage = useRef<RobotStageHandle>(null);

  const boot = async () => {
    if (!teacher) return;
    setPhase("booting");
    setState("booting");
    play("boot");
    const greeting = api<{ text: string }>(`/api/teachers/${id}/say`, { method: "POST", json: { kind: "greeting" } })
      .then((d) => d.text).catch(() => t("Beep! {title} {name}, online and ready to teach!", { title: teacher.title, name: teacher.name }));
    await new Promise((r) => setTimeout(r, 1600));
    setState("happy");
    setReaction({ kind: "wave", n: Date.now() });
    const text = await greeting;
    setState("talking");
    setLine(text);
    play("happy");
    const v = teacher.personality.voice;
    const spoken = v.enabled && speak(text, { lang: teacher.personality.language.primary, voiceId: v.voiceId, rate: v.rate, onEnd: () => setState("idle") });
    if (!spoken) setTimeout(() => setState("idle"), 2500);
    setPhase("on");
    const png = stage.current?.snapshot();
    await patch({ draft: false, wizard_step: 5, ...(png ? { avatar_url: png } : {}) }, true);
    await flush();
  };

  useEffect(() => { if (teacher && !teacher.draft && phase === "off") setState("idle"); }, [teacher, phase]);

  if (!teacher) return <main className="page"><p className="hand center">{t("Charging…")}</p></main>;
  return (
    <main className="page">
      {teacher.draft && phase !== "on" && <Conveyor id={id} current={5} reached={teacher.wizard_step} />}
      <h1 className="page-title emboss center">{t("Power On")}: {teacher.title} {teacher.name}</h1>
      <div className="workbench wood" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="stage" style={{ position: "relative" }}>
          <div className={phase === "booting" ? "crt-boot" : ""} style={{ position: "absolute", inset: 0 }}>
            <RobotStage ref={stage} config={teacher.robot_config} mode="boot" state={state} reaction={reaction} fallbackImage={teacher.avatar_url} />
          </div>
          {line && <div className="speech" style={{ position: "absolute", top: 16, left: 16, right: 16, margin: "0 auto" }}>{line}</div>}
        </div>
        <div className="row" style={{ justifyContent: "center", padding: 14 }}>
          {phase === "off" && <GelButton color="red" size="xl" sound="clunk" onClick={boot}>⚡ {t("Power On")}</GelButton>}
          {phase === "booting" && <span className="hand" style={{ fontSize: 22, color: "#fff4dc" }}>{t("Booting…")}</span>}
          {phase === "on" && <GelButton color="green" size="xl" onClick={() => router.push(`/classroom/${id}`)}>🏫 {t("Go to class")}</GelButton>}
        </div>
      </div>
    </main>
  );
}
