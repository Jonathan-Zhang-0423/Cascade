---
title: "Route plan card content through Communicator Agent for user-facing localization"
---

# Route plan card content through Communicator Agent for user-facing localization

## What & Why
The plan card currently displays content directly from the Manager Agent (summary, step titles) — but the Manager is an internal planner that shouldn't directly interact with the user. It often outputs English text even when the user types in Chinese. Per the architecture, the **Communicator Agent** is the user-facing narrator and should be responsible for producing localized plan card content in the user's language.

The fix: enhance the `plan_created` event flow so the Communicator receives the full plan details and outputs a localized version of the summary and step titles, which the frontend then displays in the plan card instead of the raw Manager output.

## Done looks like
- When a user types in Chinese, the plan card shows Chinese summary and step titles
- When a user types in English, the plan card shows English content
- The Manager Agent's raw plan is kept internally for execution (file paths, descriptions, acceptance criteria stay in English for the coding agent)
- The Communicator Agent produces the user-facing plan content
- No changes to the Manager Agent prompt

## Implementation Details

### 1. Enhance `plan_created` event to include step titles
**File: `client/src/components/ide/chat-panel.tsx`**

Currently, the `plan_created` event sent to the Communicator only includes `planSummary` and `totalSteps`. Enhance it to also include step titles so the Communicator can localize them:

```typescript
await callCommunicator({
  event: "plan_created",
  userLanguage: userLang,
  planSummary: data.plan.summary || "",
  totalSteps: steps.length,
  stepTitles: steps.map(s => s.title),  // NEW
});
```

### 2. Add `stepTitles` to `CommunicatorEvent` interface
**File: `server/communicator-prompt.ts`**

Add `stepTitles?: string[]` to the `CommunicatorEvent` interface and include them in `buildCommunicatorMessage` for the `plan_created` case:

```typescript
case "plan_created":
  lines.push(`Plan summary: ${ev.planSummary || "N/A"}`);
  lines.push(`Total steps: ${ev.totalSteps ?? "unknown"}`);
  if (ev.stepTitles?.length) {
    lines.push(`Step titles:`);
    ev.stepTitles.forEach((title, i) => lines.push(`${i + 1}. ${title}`));
  }
  break;
```

### 3. Update Communicator prompt for `plan_created` event
**File: `server/communicator-prompt.ts`**

Update the `plan_created` event description in the system prompt to instruct the Communicator to output structured plan content. The Communicator should:
- Output the plan summary in the user's language
- Output each step title in the user's language
- Use a specific structured format (like a simple prefix-based format) so the client can parse it

Add instructions like:
```
### plan_created
The planner has created a step-by-step plan. You MUST output the plan in a specific format so the app can display it as a card:

Line 1: [PLAN_SUMMARY] followed by the plan summary in the user's language
Lines 2+: [STEP_N] followed by each step title in the user's language

Example (Chinese user):
[PLAN_SUMMARY] 创建一个贪吃蛇游戏 🐍
[STEP_1] 搭建游戏页面的基本结构
[STEP_2] 绘制游戏画布和蛇的样式
[STEP_3] 添加键盘控制让蛇移动
[STEP_4] 添加食物和得分功能

Example (English user):
[PLAN_SUMMARY] Build a Snake Game 🐍
[STEP_1] Set up the basic page structure
[STEP_2] Style the game canvas and snake
[STEP_3] Add keyboard controls for snake movement
[STEP_4] Add food and scoring features

After the structured lines, you may add 1 short friendly sentence (1 line) to excite the user.
```

### 4. Parse Communicator response and overlay onto plan card
**File: `client/src/components/ide/chat-panel.tsx`**

After calling the Communicator for `plan_created`, parse the response to extract localized fields:

```typescript
function parsePlanLocalization(text: string): { summary?: string; stepTitles?: string[] } | null {
  const lines = text.split('\n');
  let summary: string | undefined;
  const stepTitles: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[PLAN_SUMMARY]')) {
      summary = trimmed.replace('[PLAN_SUMMARY]', '').trim();
    }
    const stepMatch = trimmed.match(/^\[STEP_(\d+)\]\s*(.+)/);
    if (stepMatch) {
      stepTitles[parseInt(stepMatch[1]) - 1] = stepMatch[2].trim();
    }
  }
  
  if (!summary && stepTitles.length === 0) return null;
  return { summary, stepTitles: stepTitles.length > 0 ? stepTitles : undefined };
}
```

Then, after getting the Communicator's response, overlay the localized fields onto the plan:
- Store localized summary/step titles in state (e.g., add a `localizedPlan` field to the store or apply directly to the plan object)
- The `TaskPlanCard` displays the localized summary instead of `plan.summary`
- Step titles display the localized version when available, falling back to the original

### 5. Make `plan_created` a BLOCKING event
**File: `client/src/components/ide/chat-panel.tsx`**

Currently `plan_created` is non-blocking (fire-and-forget). Since we now need the Communicator's response before displaying the plan card, add `plan_created` to the `BLOCKING_EVENTS` set so we `await` the response:

```typescript
const BLOCKING_EVENTS = new Set(["needs_input", "plan_created"]);
```

Then in `handleManagerSend`, await the Communicator response and parse it to extract localized content before adding the plan message to the store.

### 6. Update plan message storage with localized content
**File: `client/src/components/ide/chat-panel.tsx`**

After parsing the Communicator's localized response, update the plan message:

```typescript
const communicatorResponse = await callCommunicator({ event: "plan_created", ... });
const localized = parsePlanLocalization(communicatorResponse);

// Create a display version of the plan with localized content
const displayPlan = { ...data.plan };
if (localized?.summary) displayPlan.summary = localized.summary;
if (localized?.stepTitles) {
  displayPlan.steps = displayPlan.steps.map((step, i) => ({
    ...step,
    title: localized.stepTitles?.[i] || step.title,
  }));
}

addManagerMessage({ role: "assistant", content: "", plan: displayPlan });
```

## Relevant files
- `server/communicator-prompt.ts` — Communicator prompt, event types, message builder
- `client/src/components/ide/chat-panel.tsx` — `handleManagerSend`, `callCommunicator`, `TaskPlanCard`, `BLOCKING_EVENTS`
- `client/src/stores/ide-store.ts` — `ManagerPlan` type (may need optional localized fields)
