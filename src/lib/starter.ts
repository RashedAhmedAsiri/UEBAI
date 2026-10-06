import { THEME_PACKS, defaultPersonality, defaultRobot } from "./catalog";
import { templateSetup } from "./templates";
import type { Conversation, DB, Message, Teacher, Topic } from "./types";

/**
 * Starter pack: ready-made teachers that come with their own topic cards and a sample chat, so a
 * fresh site has robots to talk to straight away. The cards are written in the same Markdown
 * shape ingestion produces, so offline (demo mode) answers quote them like any filed book.
 */

interface StarterTopic { title: string; aliases: string[]; keywords: string[]; summary: string; notes: string[] }
interface StarterChat { title: string; turns: { q: string; a: string; topic: number }[] }
interface StarterBot { setup: Pick<Teacher, "name" | "title" | "robot_config" | "personality" | "subject" | "knowledge_mode">; topics: StarterTopic[]; chat: StarterChat }

function bot(lang: "ar" | "en", pack: string, o: {
  name: string; title: string; catchphrases: string[]; backstory: string;
  subject: Teacher["subject"]; robot: Partial<Teacher["robot_config"]["body"]>;
}): StarterBot["setup"] {
  const robot = defaultRobot();
  robot.body = { ...robot.body, ...o.robot };
  robot.wardrobe = { ...THEME_PACKS[pack].outfit };
  const personality = defaultPersonality(lang);
  Object.assign(personality, { name: o.name, title: o.title, catchphrases: o.catchphrases, backstory: o.backstory });
  return { name: o.name, title: o.title, robot_config: robot, personality, subject: o.subject, knowledge_mode: "files_first" };
}

const AR = { summary: "الملخص", notes: "ملاحظات أساسية" };
const EN = { summary: "Summary", notes: "Core notes" };

const BOTS: StarterBot[] = [
  {
    setup: templateSetup("saudi_history"),
    topics: [
      {
        title: "الدولة السعودية الأولى",
        aliases: ["الدرعية", "تأسيس الدولة السعودية"],
        keywords: ["الإمام محمد بن سعود", "الدرعية", "يوم التأسيس", "١١٣٩هـ", "١٧٢٧م"],
        summary: "أسّس الإمام محمد بن سعود الدولة السعودية الأولى في الدرعية عام ١١٣٩هـ (١٧٢٧م)، واستمرت حتى سقوط الدرعية عام ١٢٣٣هـ (١٨١٨م).",
        notes: [
          "المؤسس: الإمام محمد بن سعود، والعاصمة: الدرعية.",
          "التأسيس عام ١١٣٩هـ (١٧٢٧م)، ويُحتفل بذكراه في يوم التأسيس ٢٢ فبراير.",
          "وحّدت الدولة معظم أجزاء شبه الجزيرة العربية ونشرت الأمن والاستقرار.",
          "انتهت بسقوط الدرعية عام ١٢٣٣هـ (١٨١٨م) بعد حملة إبراهيم باشا.",
        ],
      },
      {
        title: "الدولة السعودية الثانية",
        aliases: ["الإمام تركي بن عبدالله"],
        keywords: ["الرياض", "تركي بن عبدالله", "١٢٤٠هـ", "١٨٢٤م"],
        summary: "أعاد الإمام تركي بن عبدالله تأسيس الدولة عام ١٢٤٠هـ (١٨٢٤م) واتخذ الرياض عاصمة لها، واستمرت حتى عام ١٣٠٩هـ (١٨٩١م).",
        notes: [
          "المؤسس: الإمام تركي بن عبدالله بن محمد بن سعود.",
          "انتقلت العاصمة من الدرعية إلى الرياض.",
          "من أبرز أئمتها الإمام فيصل بن تركي.",
          "انتهت عام ١٣٠٩هـ (١٨٩١م).",
        ],
      },
      {
        title: "توحيد المملكة العربية السعودية",
        aliases: ["الملك عبدالعزيز", "اليوم الوطني"],
        keywords: ["استرداد الرياض", "عبدالعزيز", "١٣١٩هـ", "١٣٥١هـ", "١٩٣٢م", "اليوم الوطني"],
        summary: "استرد الملك عبدالعزيز الرياض عام ١٣١٩هـ (١٩٠٢م)، ووحّد البلاد حتى أُعلن قيام المملكة العربية السعودية عام ١٣٥١هـ (١٩٣٢م).",
        notes: [
          "استرداد الرياض في ٥ شوال ١٣١٩هـ (١٩٠٢م) بداية مرحلة التوحيد.",
          "أُعلن اسم المملكة العربية السعودية في ٢١ جمادى الأولى ١٣٥١هـ (٢٣ سبتمبر ١٩٣٢م).",
          "يُحتفل باليوم الوطني في ٢٣ سبتمبر من كل عام.",
        ],
      },
      {
        title: "رؤية المملكة ٢٠٣٠",
        aliases: ["رؤية ٢٠٣٠", "الرؤية"],
        keywords: ["٢٠٣٠", "مجتمع حيوي", "اقتصاد مزدهر", "وطن طموح"],
        summary: "أُطلقت رؤية المملكة ٢٠٣٠ عام ٢٠١٦م، وتقوم على ثلاثة محاور: مجتمع حيوي، واقتصاد مزدهر، ووطن طموح.",
        notes: [
          "أُعلنت في ٢٥ أبريل ٢٠١٦م.",
          "محاورها الثلاثة: مجتمع حيوي، اقتصاد مزدهر، وطن طموح.",
          "من أهدافها تنويع الاقتصاد وتقليل الاعتماد على النفط.",
        ],
      },
    ],
    chat: {
      title: "متى تأسست الدولة السعودية؟",
      turns: [
        { q: "متى تأسست الدولة السعودية الأولى؟", a: "هيّا نفتح صفحات التاريخ! تأسست **الدولة السعودية الأولى** عام **١١٣٩هـ (١٧٢٧م)** في **الدرعية** على يد **الإمام محمد بن سعود**، ولهذا نحتفل بيوم التأسيس في ٢٢ فبراير.\n\nسؤال للتحقق: ما اسم عاصمة الدولة السعودية الأولى؟", topic: 0 },
        { q: "ومتى أُعلن قيام المملكة؟", a: "أعلن الملك عبدالعزيز قيام **المملكة العربية السعودية** في **٢١ جمادى الأولى ١٣٥١هـ (٢٣ سبتمبر ١٩٣٢م)**، وهو اليوم الوطني الذي نحتفل به كل عام. 🇸🇦", topic: 2 },
      ],
    },
  },
  {
    setup: bot("ar", "biology", {
      name: "نواة", title: "الدكتورة",
      catchphrases: ["الحياة تبدأ من خلية!", "لنكتشف أسرار الكائنات الحية."],
      backstory: "معلّمة آلية لمادة الأحياء للمرحلة الثانوية، تشرح بالأمثلة والتشبيهات من الحياة اليومية.",
      subject: { name: "الأحياء", course: "الأحياء — المرحلة الثانوية", level: "high_school", curriculum: "", materialsLanguage: "ar" },
      robot: { head: { variant: "dome", material: "toy_plastic", tint: "#5FB87A", wear: 0 }, face: { eyes: "anime", mouth: "line", screenColor: "#7CFFB2" } },
    }),
    topics: [
      {
        title: "الخلية",
        aliases: ["الخلية الحية", "تركيب الخلية"],
        keywords: ["النواة", "الغشاء البلوري", "الميتوكوندريا", "السيتوبلازم", "عضيات"],
        summary: "الخلية هي الوحدة الأساسية لبناء الكائنات الحية ووظائفها، وتحتوي على عضيات لكل منها وظيفة.",
        notes: [
          "النواة: تحتوي على المادة الوراثية DNA وتتحكم في أنشطة الخلية.",
          "الغشاء البلازمي: يتحكم في دخول المواد وخروجها.",
          "الميتوكوندريا: مركز إنتاج الطاقة في الخلية.",
          "الخلية النباتية لها جدار خلوي وبلاستيدات خضراء، والحيوانية لا.",
        ],
      },
      {
        title: "البناء الضوئي",
        aliases: ["التمثيل الضوئي", "البناء الضوئي في النبات"],
        keywords: ["الكلوروفيل", "البلاستيدات الخضراء", "الجلوكوز", "ثاني أكسيد الكربون", "الأكسجين"],
        summary: "البناء الضوئي عملية تصنع فيها النباتات الغذاء (الجلوكوز) من الماء وثاني أكسيد الكربون باستخدام طاقة الضوء، ويخرج الأكسجين.",
        notes: [
          "يحدث في البلاستيدات الخضراء بفضل صبغة الكلوروفيل.",
          "المعادلة: ٦CO₂ + ٦H₂O + ضوء ← C₆H₁₂O₆ + ٦O₂.",
          "المدخلات: الماء، ثاني أكسيد الكربون، الضوء.",
          "المخرجات: الجلوكوز والأكسجين.",
        ],
      },
      {
        title: "الوراثة و DNA",
        aliases: ["الوراثة", "الحمض النووي"],
        keywords: ["DNA", "الجينات", "الكروموسومات", "مندل", "الصفات الوراثية"],
        summary: "الوراثة هي انتقال الصفات من الآباء إلى الأبناء عن طريق الجينات المحمولة على جزيئات DNA.",
        notes: [
          "DNA جزيء على شكل لولب مزدوج يحمل المعلومات الوراثية.",
          "الجين جزء من DNA يحدد صفة معيّنة.",
          "يحتوي الإنسان على ٢٣ زوجًا من الكروموسومات.",
          "مندل هو مؤسس علم الوراثة من تجاربه على نبات البازلاء.",
        ],
      },
    ],
    chat: {
      title: "ما هو البناء الضوئي؟",
      turns: [
        { q: "ما هو البناء الضوئي؟", a: "الحياة تبدأ من خلية! **البناء الضوئي** هو مطبخ النبات 🌱: يأخذ **الماء** و**ثاني أكسيد الكربون** ويستخدم **طاقة الضوء** ليصنع **الجلوكوز**، ويطلق **الأكسجين** الذي نتنفسه.\n\nيحدث داخل **البلاستيدات الخضراء** بفضل صبغة **الكلوروفيل**.\n\nسؤال سريع: ما الغاز الذي يخرج من النبات أثناء البناء الضوئي؟", topic: 1 },
      ],
    },
  },
  {
    setup: bot("en", "mathematics", {
      name: "Pi", title: "Prof.",
      catchphrases: ["Let's crunch some numbers!", "Every problem has a pattern."],
      backstory: "A cheerful math robot for high school students. Explains every step and checks understanding with quick questions.",
      subject: { name: "Mathematics", course: "High school math", level: "high_school", curriculum: "", materialsLanguage: "en" },
      robot: { head: { variant: "cube", material: "brushed_steel", tint: "#4A6FA5", wear: 0.05 }, face: { eyes: "glasses", mouth: "equalizer", screenColor: "#6EC6FF" } },
    }),
    topics: [
      {
        title: "Pythagorean theorem",
        aliases: ["Pythagoras", "right triangle"],
        keywords: ["hypotenuse", "a² + b² = c²", "right angle", "triangle", "legs"],
        summary: "In a right triangle, the square of the hypotenuse equals the sum of the squares of the other two sides: a² + b² = c².",
        notes: [
          "Only works for right triangles (one angle is 90°).",
          "c is the hypotenuse: the longest side, opposite the right angle.",
          "Example: legs 3 and 4 give c = √(9 + 16) = √25 = 5.",
          "Common triples: (3, 4, 5), (5, 12, 13), (8, 15, 17).",
        ],
      },
      {
        title: "Linear equations",
        aliases: ["solving equations", "solve for x"],
        keywords: ["variable", "solve", "x", "equation", "slope", "y = mx + b"],
        summary: "A linear equation has a variable to the first power. Solve it by doing the same operation to both sides until the variable is alone.",
        notes: [
          "Undo addition/subtraction first, then multiplication/division.",
          "Example: 2x + 3 = 11 → 2x = 8 → x = 4.",
          "Check by substituting: 2(4) + 3 = 11 ✓.",
          "A line in the plane is written y = mx + b, where m is the slope and b the y-intercept.",
        ],
      },
      {
        title: "Fractions",
        aliases: ["adding fractions", "fraction operations"],
        keywords: ["numerator", "denominator", "common denominator", "simplify", "multiply fractions"],
        summary: "A fraction a/b means a parts out of b equal parts. Add with a common denominator; multiply straight across.",
        notes: [
          "Add/subtract: rewrite with a common denominator, e.g. 1/2 + 1/3 = 3/6 + 2/6 = 5/6.",
          "Multiply: numerators times numerators, denominators times denominators.",
          "Divide: multiply by the reciprocal, e.g. (1/2) ÷ (1/4) = (1/2) × 4 = 2.",
          "Simplify by dividing top and bottom by their greatest common factor.",
        ],
      },
    ],
    chat: {
      title: "How does the Pythagorean theorem work?",
      turns: [
        { q: "How does the Pythagorean theorem work?", a: "Let's crunch some numbers! In a **right triangle**, the two short sides (legs) **a** and **b** and the long side (hypotenuse) **c** always satisfy:\n\n**a² + b² = c²**\n\nExample: legs 3 and 4 → c² = 9 + 16 = 25 → **c = 5**.\n\nQuick check: if the legs are 6 and 8, how long is the hypotenuse?", topic: 0 },
        { q: "Is it 10?", a: "Yes! 6² + 8² = 36 + 64 = 100, and √100 = **10**. 🎉 Notice it's just the 3-4-5 triangle doubled.", topic: 0 },
      ],
    },
  },
  {
    setup: bot("en", "physics", {
      name: "Newton", title: "Dr.",
      catchphrases: ["Forces are everywhere!", "Physics is just curiosity with equations."],
      backstory: "A physics robot who loves experiments and real-life examples, from soccer kicks to rocket launches.",
      subject: { name: "Physics", course: "High school physics", level: "high_school", curriculum: "", materialsLanguage: "en" },
      robot: { head: { variant: "lightbulb", material: "copper", tint: "#E0A458", wear: 0.15 }, face: { eyes: "pixel_dots", mouth: "grille", screenColor: "#FFB347" } },
    }),
    topics: [
      {
        title: "Newton's laws of motion",
        aliases: ["Newton's laws", "laws of motion", "inertia"],
        keywords: ["inertia", "F = ma", "action reaction", "force", "acceleration", "mass"],
        summary: "Newton's three laws describe how forces change motion: inertia, F = ma, and equal-and-opposite reactions.",
        notes: [
          "1st law (inertia): an object stays at rest or in steady motion unless a net force acts on it.",
          "2nd law: net force = mass × acceleration (F = ma), measured in newtons (N).",
          "3rd law: every action has an equal and opposite reaction.",
          "Example: a 2 kg ball pushed with 10 N accelerates at 5 m/s².",
        ],
      },
      {
        title: "Energy",
        aliases: ["kinetic energy", "potential energy", "conservation of energy"],
        keywords: ["kinetic", "potential", "joule", "KE = ½mv²", "PE = mgh", "conservation"],
        summary: "Energy is the ability to do work, measured in joules. It changes form but is never created or destroyed.",
        notes: [
          "Kinetic energy (motion): KE = ½mv².",
          "Gravitational potential energy (height): PE = mgh, with g ≈ 9.8 m/s².",
          "Conservation of energy: total energy in a closed system stays constant.",
          "Example: a falling ball turns potential energy into kinetic energy.",
        ],
      },
    ],
    chat: {
      title: "What is Newton's second law?",
      turns: [
        { q: "What is Newton's second law?", a: "Forces are everywhere! Newton's **second law** says the net force on an object equals its mass times its acceleration:\n\n**F = ma**\n\nSo a 2 kg ball pushed with 10 N speeds up at 10 ÷ 2 = **5 m/s²**. Push harder, it accelerates more; make it heavier, it accelerates less.\n\nYour turn: what force gives a 4 kg cart an acceleration of 3 m/s²?", topic: 0 },
      ],
    },
  },
];

/** Adds the starter teachers, their topic cards and one sample chat each to the database. */
export function addStarterPack(d: DB, uid: () => string = () => crypto.randomUUID(), at = new Date().toISOString()): number {
  for (const b of BOTS) {
    const ar = b.setup.personality.language.primary === "ar";
    const L = ar ? AR : EN;
    const teacher: Teacher = {
      id: uid(), ...structuredClone(b.setup), avatar_url: null, draft: false, wizard_step: 5,
      last_topic_title: b.topics[b.chat.turns.at(-1)!.topic].title, tokens_saved: 0, created_at: at, updated_at: at,
    };
    const topics: Topic[] = b.topics.map((t) => {
      const notes_md = `### ${L.summary}\n${t.summary}\n\n### ${L.notes}\n${t.notes.map((n) => `- ${n}`).join("\n")}`;
      return {
        id: uid(), teacher_id: teacher.id, unit_id: null, parent_topic_id: null, title: t.title, aliases: t.aliases, keywords: t.keywords,
        card_summary: t.summary, notes_md, notes_tokens: Math.ceil(notes_md.length / 4), notes_user_edited: false,
        paragraph_ids: [], source_refs: [], dirty: false, version: 1, created_at: at, updated_at: at,
      };
    });
    const conv: Conversation = { id: uid(), teacher_id: teacher.id, title: b.chat.title, active_topic_ids: [topics[b.chat.turns.at(-1)!.topic].id], created_at: at };
    const messages: Message[] = b.chat.turns.flatMap((turn) => {
      const base = { conversation_id: conv.id, citations: [], tokens_in: 0, tokens_out: 0, baseline_tokens: 0, created_at: at };
      return [
        { ...base, id: uid(), role: "user" as const, content: turn.q, topic_ids: [], tiers_used: [] },
        { ...base, id: uid(), role: "assistant" as const, content: turn.a, topic_ids: [topics[turn.topic].id], tiers_used: [1, 2] },
      ];
    });
    d.teachers.push(teacher);
    d.topics.push(...topics);
    d.conversations.push(conv);
    d.messages.push(...messages);
  }
  return BOTS.length;
}
