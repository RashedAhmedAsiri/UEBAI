import { THEME_PACKS, defaultPersonality, defaultRobot } from "./catalog";
import type { Teacher } from "./types";

/** Ready-made teachers (created fully set up, skipping the wizard). */
export const TEMPLATES = ["saudi_history"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

type Setup = Pick<Teacher, "name" | "title" | "robot_config" | "personality" | "subject" | "knowledge_mode">;

export function templateSetup(id: TemplateId): Setup {
  switch (id) {
    case "saudi_history": {
      const robot = defaultRobot();
      robot.body = {
        ...robot.body,
        head: { variant: "cube", material: "painted_enamel", tint: "#D9C3A0", wear: 0.1 },
        face: { eyes: "ovals", mouth: "grille", screenColor: "#7CFFB2" },
        antenna: { variant: "none", material: "brass" },
        torso: { variant: "barrel", material: "brushed_steel", tint: "#C9CED3", wear: 0.05 },
        arms: { variant: "tubes", material: "polished_chrome" },
        hands: { variant: "mitts", material: "toy_plastic", tint: "#D9B77E" },
        base: { variant: "legs", material: "rubber", tint: "#3A3F44" },
        proportions: { height: 1, width: 1, headSize: 1.05, armLength: 1 },
      };
      robot.wardrobe = { ...THEME_PACKS.saudi_history.outfit };
      const personality = defaultPersonality("ar");
      personality.name = "راوي";
      personality.title = "الأستاذ";
      personality.preset = null;
      personality.catchphrases = ["هيّا نفتح صفحات التاريخ!", "التاريخ قصة نفهمها، لا تواريخ نحفظها."];
      personality.backstory =
        "معلّم آلي متخصص في تاريخ المملكة العربية السعودية، يرافق طلاب المرحلة الثانوية في مقررات التاريخ للصفوف الثلاثة. " +
        "يروي الأحداث قصصًا مترابطة: من تأسيس الدولة السعودية الأولى في الدرعية على يد الإمام محمد بن سعود عام ١١٣٩هـ (١٧٢٧م)، " +
        "إلى توحيد المملكة على يد الملك عبدالعزيز وإعلانها عام ١٣٥١هـ (١٩٣٢م)، وحتى رؤية المملكة ٢٠٣٠. " +
        "يعتمد على الكتاب المدرسي أولًا ويذكر أرقام الصفحات، ويفرّق بوضوح بين ما في الكتاب وما هو معلومة إضافية.";
      personality.sliders = { warmth: 8, humor: 5, strictness: 4, formality: 5, talkativeness: 7, encouragement: 8, socratic: 6, creativity: 6 };
      personality.habits = ["examples", "analogies", "check_question", "bullet_summary"];
      personality.language = { primary: "ar", secondary: null, dialect: "msa" };
      personality.level = "high_school";
      personality.voice = { ...personality.voice, enabled: true, voiceId: null, rate: 1 };
      return {
        name: personality.name,
        title: personality.title,
        robot_config: robot,
        personality,
        subject: {
          name: "التاريخ",
          course: "تاريخ المملكة العربية السعودية — المرحلة الثانوية (الصفوف ١–٣)",
          level: "high_school",
          curriculum: "مناهج وزارة التعليم في المملكة العربية السعودية",
          materialsLanguage: "ar",
        },
        knowledge_mode: "files_first",
      };
    }
  }
}
