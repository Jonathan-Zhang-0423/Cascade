import type { BuildPlan, BuildStep } from "../orchestrator/build-orchestrator";
import type { ContextPacket } from "./types";

export interface FileLike {
  path: string;
  content?: string;
}

function unique(values: string[]): string[] {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

function inferChangeMode(userIntent?: string, completedRoundSummary?: string, projectMemory?: string): "new-build" | "follow-up" {
  const text = `${userIntent ?? ""}\n${completedRoundSummary ?? ""}\n${projectMemory ?? ""}`.toLowerCase();
  const followUpSignals = [
    "fix",
    "bug",
    "again",
    "now ",
    "next",
    "add ",
    "change",
    "update",
    "modify",
    "keep",
    "preserve",
    "修",
    "改",
    "再",
    "继续",
    "新增",
    "添加",
    "保留",
  ];
  if (completedRoundSummary || projectMemory) return "follow-up";
  return followUpSignals.some((signal) => text.includes(signal)) ? "follow-up" : "new-build";
}

function truncate(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

export function estimateContextPacketTokens(packet: ContextPacket): number {
  return Math.ceil(renderContextPacket(packet).length / 4);
}

export interface RenderContextPacketOptions {
  includeProjectMemory?: boolean;
  includeSkillContent?: boolean;
  includeExternalGuidance?: boolean;
}

export function renderContextPacket(packet: ContextPacket, options: RenderContextPacketOptions = {}): string {
  const includeProjectMemory = options.includeProjectMemory ?? true;
  const includeSkillContent = options.includeSkillContent ?? true;
  const includeExternalGuidance = options.includeExternalGuidance ?? true;
  const sections: string[] = [];
  if (packet.projectIdentity || packet.projectId) {
    sections.push(`## Project Identity\n${packet.projectIdentity || packet.projectId}`);
  }
  if (packet.userIntent) sections.push(`## User Intent\n${truncate(packet.userIntent, 1200)}`);
  if (packet.planSummary) sections.push(`## Current Plan\n${truncate(packet.planSummary, 1200)}`);
  if (packet.stepScope) {
    sections.push([
      "## Step Scope",
      `Steps: ${packet.stepScope.stepIds.join(", ") || "(none)"}`,
      `Required files: ${packet.stepScope.requiredFiles.join(", ") || "(none)"}`,
    ].join("\n"));
  }
  if (packet.filesManifest.length > 0) {
    sections.push(`## Files Manifest\n${packet.filesManifest.map((p) => `- ${p}`).join("\n")}`);
  }
  if (packet.completedRoundSummary) {
    sections.push(`## Previous Round Summary\n${truncate(packet.completedRoundSummary, 1800)}`);
  }
  if (includeProjectMemory && packet.projectMemory) {
    sections.push(`## Project Memory\n${truncate(packet.projectMemory, 4000)}`);
  }
  if (packet.preservationConstraints.length > 0) {
    sections.push(`## Preservation Constraints\n${packet.preservationConstraints.map((p) => `- ${p}`).join("\n")}`);
  }
  if (packet.recentToolSummary) sections.push(`## Recent Tool Summary\n${truncate(packet.recentToolSummary, 1200)}`);
  if (includeSkillContent && packet.skillContent) sections.push(`## Skill Guidance\n${truncate(packet.skillContent, 6000)}`);
  if (includeExternalGuidance && packet.externalGuidance) sections.push(`## External Guidance\n${truncate(packet.externalGuidance, 4000)}`);
  return sections.join("\n\n");
}

export function compactContextPacket(packet: ContextPacket, maxTokens: number): ContextPacket {
  if (estimateContextPacketTokens(packet) <= maxTokens) return packet;
  return {
    ...packet,
    projectMemory: packet.projectMemory ? truncate(packet.projectMemory, 1800) : packet.projectMemory,
    skillContent: packet.skillContent ? truncate(packet.skillContent, 2200) : packet.skillContent,
    externalGuidance: packet.externalGuidance ? truncate(packet.externalGuidance, 1600) : packet.externalGuidance,
    recentToolSummary: packet.recentToolSummary ? truncate(packet.recentToolSummary, 800) : packet.recentToolSummary,
  };
}

export function buildManagerContextPacket(args: {
  projectId?: string;
  files: FileLike[];
  userIntent?: string;
  completedRoundSummary?: string;
  projectMemory?: string;
  skillContent?: string;
  externalGuidance?: string;
}): ContextPacket {
  const filePaths = unique(args.files.map((f) => f.path));
  const changeMode = inferChangeMode(args.userIntent, args.completedRoundSummary, args.projectMemory);
  return {
    projectId: args.projectId,
    projectIdentity: filePaths.length > 0
      ? `Current project files: ${filePaths.join(", ")}`
      : "Empty project",
    userIntent: args.userIntent,
    filesManifest: filePaths,
    completedRoundSummary: args.completedRoundSummary,
    projectMemory: args.projectMemory,
    skillContent: args.skillContent,
    externalGuidance: args.externalGuidance,
    preservationConstraints: [
      "Treat existing user-facing behavior as current project truth.",
      "Plans must extend prior work and must not delete, rewrite, or regress completed features unless the user explicitly asks.",
      ...(changeMode === "follow-up"
        ? [
            "This is a follow-up/change request: plan the smallest safe delta on top of the existing app.",
            "Include required_files for every file that may be touched so the editor can inspect current code before changing it.",
          ]
        : []),
    ],
  };
}

export function buildEditorContextPacket(args: {
  projectId?: string;
  files: FileLike[];
  userIntent: string;
  plan: BuildPlan;
  steps: BuildStep[];
  completedRoundSummary?: string;
  projectMemory?: string;
  skillContent?: string;
  externalGuidance?: string;
}): ContextPacket {
  const filePaths = unique(args.files.map((f) => f.path));
  const requiredFiles = unique(args.steps.flatMap((s) => s.required_files ?? []));
  const changeMode = inferChangeMode(args.userIntent, args.completedRoundSummary, args.projectMemory);
  return {
    projectId: args.projectId,
    projectIdentity: filePaths.length > 0
      ? `Current project files: ${filePaths.join(", ")}`
      : "Empty project",
    userIntent: args.userIntent,
    planSummary: args.plan.summary,
    stepScope: {
      stepIds: args.steps.map((s) => s.sub_task_id ?? s.step),
      requiredFiles,
    },
    filesManifest: filePaths,
    completedRoundSummary: args.completedRoundSummary,
    projectMemory: args.projectMemory,
    skillContent: args.skillContent,
    externalGuidance: args.externalGuidance,
    preservationConstraints: [
      "Preserve unrelated existing code.",
      "Preserve prior user-facing behavior unless the current plan explicitly changes it.",
      "Prefer targeted edits for existing files.",
      ...(changeMode === "follow-up"
        ? [
            "This is an incremental follow-up: inspect current behavior before editing and change only the files/regions needed for the new request.",
            "Do not reset, simplify, or recreate existing screens, state models, event handlers, styles, or assets unless the plan explicitly names that regression as desired.",
            "When modifying an existing file, use edit_file/patch_file/hash_patch_file whenever possible; use write_file only for true full rewrites with the latest expected_hash.",
          ]
        : []),
    ],
  };
}
