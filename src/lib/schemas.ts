import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const PartSchema = z.object({
  variant: z.string(),
  material: z.string().optional(),
  tint: hex.optional(),
  wear: z.number().min(0).max(1).optional(),
  decal: z.string().nullable().optional(),
});

export const RobotConfigSchema = z.object({
  version: z.literal(1),
  body: z.object({
    head: PartSchema,
    face: z.object({ eyes: z.string(), mouth: z.string(), screenColor: hex }),
    antenna: PartSchema,
    ears: PartSchema,
    torso: PartSchema,
    chest: PartSchema,
    arms: PartSchema,
    hands: PartSchema,
    base: PartSchema,
    proportions: z.object({
      height: z.number().min(0.6).max(1.5),
      width: z.number().min(0.6).max(1.5),
      headSize: z.number().min(0.6).max(1.6),
      armLength: z.number().min(0.5).max(1.6),
    }),
  }),
  wardrobe: z.object({
    top: z.string().nullable(),
    neck: z.string().nullable(),
    headwear: z.string().nullable(),
    eyewear: z.string().nullable(),
    leftHand: z.string().nullable(),
    rightHand: z.string().nullable(),
    back: z.string().nullable(),
    badges: z.array(z.string()).max(3),
    deskProp: z.string().nullable(),
  }),
});
export type RobotConfig = z.infer<typeof RobotConfigSchema>;
export type BodySlot = Exclude<keyof RobotConfig["body"], "face" | "proportions">;

export const SLIDER_KEYS = [
  "warmth", "humor", "strictness", "formality", "talkativeness", "encouragement", "socratic", "creativity",
] as const;
export type SliderKey = (typeof SLIDER_KEYS)[number];

export const HABITS = [
  "analogies", "examples", "step_by_step", "check_question", "mini_quiz", "bullet_summary", "emojis",
] as const;

export const LEVELS = ["elementary", "middle", "high_school", "university", "adult"] as const;

export const PersonalitySchema = z.object({
  name: z.string().min(1).max(40),
  title: z.string().max(20),
  catchphrases: z.array(z.string().max(120)).max(3),
  backstory: z.string().max(1000),
  preset: z.string().nullable(),
  sliders: z.object(Object.fromEntries(SLIDER_KEYS.map((k) => [k, z.number().min(0).max(10)])) as Record<SliderKey, z.ZodNumber>),
  habits: z.array(z.enum(HABITS)),
  language: z.object({
    primary: z.enum(["en", "ar"]),
    secondary: z.enum(["en", "ar"]).nullable(),
    dialect: z.enum(["msa", "saudi"]).nullable(),
  }),
  level: z.enum(LEVELS),
  voice: z.object({
    enabled: z.boolean(),
    voiceId: z.string().nullable(),
    pitch: z.number().min(0.5).max(2),
    rate: z.number().min(0.5).max(2),
    robotFilter: z.number().min(0).max(1),
  }),
});
export type Personality = z.infer<typeof PersonalitySchema>;

export const KNOWLEDGE_MODES = ["internet", "files_strict", "files_first"] as const;
export type KnowledgeMode = (typeof KNOWLEDGE_MODES)[number];

export const SubjectSchema = z.object({
  name: z.string().max(80),
  course: z.string().max(120),
  level: z.enum(LEVELS),
  curriculum: z.string().max(120),
  materialsLanguage: z.enum(["en", "ar", "mixed"]),
});
export type Subject = z.infer<typeof SubjectSchema>;

export const TeacherPatchSchema = z.object({
  name: z.string().max(40).optional(),
  title: z.string().max(20).optional(),
  robot_config: RobotConfigSchema.optional(),
  personality: PersonalitySchema.optional(),
  subject: SubjectSchema.optional(),
  knowledge_mode: z.enum(KNOWLEDGE_MODES).optional(),
  avatar_url: z.string().max(2_000_000).nullable().optional(),
  draft: z.boolean().optional(),
  wizard_step: z.number().int().min(0).max(5).optional(),
});
