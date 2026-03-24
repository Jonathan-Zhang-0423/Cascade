import type { ToolSchema, ToolHandler } from "./agent-loop";
import type { BuildSessionState, BuildStep, SseEmit } from "./build-orchestrator";

export interface VerifierIssue {
  type: "bug" | "missing_feature" | "regression";
  description: string;
  affected_file?: string;
}

export interface VerifierVerdict {
  status: "pass" | "fail";
  summary: string;
  requirementMatchPercent: number;
}

export interface VerifierSessionState {
  issues: VerifierIssue[];
  verdict?: VerifierVerdict;
  review?: Record<string, unknown>;
}

export interface ManagerSessionState {
  plan?: Record<string, unknown>;
}

export function buildBuilderTools(
  session: BuildSessionState,
  planSteps?: BuildStep[],
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const stepByNum = new Map<number, BuildStep>();
  if (planSteps) {
    for (const s of planSteps) stepByNum.set(s.step, s);
  }
  const totalSteps = planSteps?.length ?? 0;

  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write or overwrite a file in the project with the given content. Use this to create or modify any project file.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path, e.g. /project/index.html",
            },
            content: {
              type: "string",
              description: "The complete file content to write",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the current content of a file from the project. Use this to understand existing code before modifying it.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to read, e.g. /project/index.html",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mark_step_complete",
        description: "Mark a plan step as complete after you have written all files for it.",
        parameters: {
          type: "object",
          properties: {
            step_id: {
              type: "string",
              description: "The step number or sub_task_id being completed, e.g. '1' or 'T001-01'",
            },
            summary: {
              type: "string",
              description: "Brief summary of what was accomplished in this step",
            },
          },
          required: ["step_id", "summary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "request_review",
        description: "Signal that you are done implementing all steps and the project is ready for quality review. Call this ONLY when all plan steps are complete.",
        parameters: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "A brief summary of everything you built",
            },
          },
          required: ["summary"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    write_file: async (args, emit) => {
      const path = args.path as string;
      const content = args.content as string;
      if (!path || typeof content !== "string") {
        return "Error: path and content are required";
      }
      emit({ type: "narration_token", token: `\nWriting: ${path}` });
      session.files.set(path, content);
      emit({ type: "code_applied", filePath: path, code: content });
      return `File written successfully: ${path} (${content.length} chars)`;
    },

    read_file: async (args, emit) => {
      const path = args.path as string;
      if (!path) return "Error: path is required";
      emit({ type: "narration_token", token: `\nReading: ${path}` });
      const content = session.files.get(path);
      if (content === undefined) {
        return `File not found: ${path}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      return `File: ${path}\n\n${content}`;
    },

    mark_step_complete: async (args, emit) => {
      const stepId = args.step_id as string;
      const summary = args.summary as string;
      const stepNum = parseInt(stepId, 10);
      if (summary) {
        emit({ type: "narration_token", token: `\nStep ${stepId} complete: ${summary}` });
      }
      emit({ type: "step_completed", stepNumber: isNaN(stepNum) ? stepId : stepNum });

      if (!isNaN(stepNum) && totalSteps > 0) {
        const nextStep = stepByNum.get(stepNum + 1);
        if (nextStep) {
          emit({ type: "step_starting", stepNumber: nextStep.step, stepTitle: nextStep.title, totalSteps });
        }
      }

      return `Step ${stepId} marked complete: ${summary}`;
    },

    request_review: async (_args, emit) => {
      emit({ type: "narration_token", token: "\nReviewing completed work…" });
      emit({ type: "reviewing" });
      return "Review requested. Proceeding to quality review phase.";
    },
  };

  return { schemas, handlers };
}

export function buildVerifierTools(
  session: BuildSessionState,
  verifierState: VerifierSessionState,
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the current content of a file from the project to review it.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to read, e.g. /project/index.html",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "report_issue",
        description: "Report a bug, missing feature, or regression found during review.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["bug", "missing_feature", "regression"],
              description: "The type of issue",
            },
            description: {
              type: "string",
              description: "Clear description of the issue",
            },
            affected_file: {
              type: "string",
              description: "The file path where the issue exists (optional)",
            },
          },
          required: ["type", "description"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submit_verdict",
        description: "Submit your final review verdict. Call this when you have reviewed all relevant files and reported all issues.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pass", "fail"],
              description: "Pass if the project meets requirements, fail if there are critical/major issues",
            },
            summary: {
              type: "string",
              description: "A plain-language summary of your review findings for the user",
            },
            requirement_match_percent: {
              type: "number",
              description: "Estimated percentage of requirements that are met (0-100)",
            },
          },
          required: ["status", "summary"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    read_file: async (args) => {
      const path = args.path as string;
      if (!path) return "Error: path is required";
      const content = session.files.get(path);
      if (content === undefined) {
        return `File not found: ${path}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      return `File: ${path}\n\n${content}`;
    },

    report_issue: async (args) => {
      const issueType = args.type as VerifierIssue["type"];
      const description = args.description as string;
      const affected_file = args.affected_file as string | undefined;
      verifierState.issues.push({ type: issueType, description, affected_file });
      return `Issue recorded (${issueType}): ${description}`;
    },

    submit_verdict: async (args) => {
      const status = args.status as "pass" | "fail";
      const summary = args.summary as string;
      const requirementMatchPercent = typeof args.requirement_match_percent === "number"
        ? args.requirement_match_percent
        : (status === "pass" ? 95 : 60);

      const bugs = verifierState.issues.filter(i => i.type === "bug").map((i, idx) => ({
        id: `BUG-${idx + 1}`,
        severity: "major" as const,
        file: i.affected_file ?? "unknown",
        description: i.description,
        expected: "",
        actual: "",
      }));
      const missing_features = verifierState.issues.filter(i => i.type === "missing_feature").map((i, idx) => ({
        id: `MISS-${idx + 1}`,
        description: i.description,
        related_step: 0,
      }));
      const regressions = verifierState.issues.filter(i => i.type === "regression").map((i, idx) => ({
        id: `REG-${idx + 1}`,
        file: i.affected_file ?? "unknown",
        description: i.description,
      }));

      verifierState.verdict = { status, summary, requirementMatchPercent };
      verifierState.review = {
        overall_status: status,
        bugs,
        missing_features,
        regressions,
        summary,
        suggestion: "",
        requirement_match_percent: requirementMatchPercent,
        user_confirmation_needed: [],
      };

      return `Verdict submitted: ${status}`;
    },
  };

  return { schemas, handlers };
}

export function buildManagerTools(
  managerState: ManagerSessionState,
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "submit_plan",
        description: "Submit the final build plan when the user has confirmed what they want to build. Only call this after the user has confirmed your Stage 2 summary.",
        parameters: {
          type: "object",
          properties: {
            project_name: {
              type: "string",
              description: "Short project name (2-5 words)",
            },
            overview: {
              type: "string",
              description: "3-5 sentence overview of the approach and technical decisions",
            },
            what_and_why: {
              type: "string",
              description: "2-3 sentences describing what is being built and why",
            },
            done_looks_like: {
              type: "string",
              description: "Concrete description of the end state",
            },
            out_of_scope: {
              type: "string",
              description: "Brief statement of related but excluded concerns",
            },
            relevant_files: {
              type: "array",
              items: { type: "string" },
              description: "Every file that will be created or modified",
            },
            summary: {
              type: "string",
              description: "Brief one-line description of the plan",
            },
            steps: {
              type: "array",
              description: "The ordered build steps",
              items: {
                type: "object",
                properties: {
                  step: { type: "number" },
                  sub_task_id: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  acceptance_criteria: { type: "string" },
                  required_files: { type: "array", items: { type: "string" } },
                },
                required: ["step", "title", "description"],
              },
            },
            needs_input: {
              type: "array",
              items: { type: "string" },
              description: "Items needing user decision, empty array if none",
            },
          },
          required: ["steps", "summary"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    submit_plan: async (args) => {
      const plan: Record<string, unknown> = {
        overview: args.overview as string,
        what_and_why: args.what_and_why as string,
        done_looks_like: args.done_looks_like as string,
        out_of_scope: args.out_of_scope as string,
        relevant_files: args.relevant_files as string[],
        summary: args.summary as string,
        steps: args.steps as unknown[],
        needs_input: (args.needs_input as string[] | undefined) ?? [],
      };
      managerState.plan = plan;
      return "Plan submitted successfully.";
    },
  };

  return { schemas, handlers };
}

export function buildFixerTools(session: BuildSessionState, planSteps?: BuildStep[]): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  return buildBuilderTools(session, planSteps);
}
