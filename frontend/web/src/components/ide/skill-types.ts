export type SkillType = "knowledge" | "tool";

export interface Skill {
  id?: number;
  name: string;
  description: string;
  type: SkillType;
  content: string;
  enabled: boolean;
}
