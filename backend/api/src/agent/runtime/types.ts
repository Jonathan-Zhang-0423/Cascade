import type OpenAI from "openai";
import type { ToolHandler, ToolSchema } from "../loop/agent-loop";
import type { AIProvider } from "../providers/kimi-client";

export type AgentRole =
  | "manager"
  | "explorer"
  | "editor"
  | "verifier"
  | "fixer"
  | "research"
  | "communicator"
  | "memory";

export interface ContextPacket {
  projectId?: string;
  projectIdentity?: string;
  userIntent?: string;
  planSummary?: string;
  stepScope?: {
    stepIds: Array<number | string>;
    requiredFiles: string[];
  };
  filesManifest: string[];
  completedRoundSummary?: string;
  projectMemory?: string;
  preservationConstraints: string[];
  recentToolSummary?: string;
  skillContent?: string;
  externalGuidance?: string;
}

export interface ToolPolicy {
  name: string;
  category:
    | "read"
    | "search"
    | "edit"
    | "delete"
    | "shell"
    | "test"
    | "control"
    | "memory"
    | "network"
    | "review"
    | "other";
  mutatesFiles: boolean;
  safeToParallelize: boolean;
  allowedRoles?: AgentRole[];
  resultCompaction?: "none" | "standard" | "aggressive";
}

export interface RuntimePolicy {
  role: AgentRole;
  provider?: AIProvider;
  model?: string;
  maxIterations: number;
  thinkingMode?: "auto" | "enabled" | "disabled";
  routingMode?: "role_first" | "user_first";
  thinkingProfile?: "adaptive" | "always" | "minimal" | "disabled";
  maxOutputTokens?: number;
  contextCompactionProfile?: "standard" | "aggressive" | "preserve-memory";
  contextBudgetTokens?: number;
  stallPolicy?: {
    discoveryNudgeMinIteration: number;
    discoveryNudgeThreshold: number;
  };
  toolPolicies?: Record<string, ToolPolicy>;
}

export interface AgentRunSpec {
  systemPrompt: string;
  initialMessages: Array<{ role: "user" | "assistant"; content: string }>;
  tools: ToolSchema[];
  handlers: Record<string, ToolHandler>;
  runtime: RuntimePolicy;
  client?: OpenAI;
}
