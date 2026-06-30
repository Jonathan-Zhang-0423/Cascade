export interface ManagerPlanStep {
  step_number: number;
  title: string;
  description: string;
  required_files: string[];
  acceptance_criteria: string[];
}

export interface ManagerPlan {
  summary: string;
  what_and_why: string;
  done_looks_like: string;
  out_of_scope: string;
  steps: ManagerPlanStep[];
}

export interface BuildStep {
  id: string;
  title: string;
  description: string;
  required_files: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export type Framework =
  | 'web'
  | 'rn-expo'
  | 'flutter'
  | 'swiftui'
  | 'kotlin'
  | 'wechat';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
