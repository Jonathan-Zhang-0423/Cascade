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

export type SquareVisibility = 'public' | 'link_only' | 'private';

export interface PublishedApp {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  description: string | null;
  isOpenSource: boolean;
  visibility: SquareVisibility;
  previewScreenshot: string | null;
  framework: string;
  publishedAt: string;
  updatedAt: string;
  authorUsername?: string;
}

export interface SquareListItem {
  id: string;
  title: string;
  description: string | null;
  isOpenSource: boolean;
  framework: string;
  previewScreenshot: string | null;
  publishedAt: string;
  authorUsername: string;
}
