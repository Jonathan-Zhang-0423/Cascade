---
title: "Add Prompt Engineering Tips to Deep Dive feature cards"
---

# Add Prompt Engineering Tips to Deep Dive feature cards

## What & Why
Under each feature explanation in the 深度解析 (Deep Dive) section, add a "Prompt Engineering Tip" — a practical suggestion from the Mentor Agent teaching the user the best prompt to give an AI coding agent for building that specific feature. This turns every feature card into a mini prompt-engineering lesson, helping beginners learn not just what the code does but how to ask for it effectively.

The tip should be locale-aware:
- English: "Try this prompt next time when you are building this feature: …"
- Chinese: "下次搭建这个功能时，试试这些提示语: …"

## Done looks like
- Each feature card in the Deep Dive section shows a prompt engineering tip after the code blocks
- The tip is visually distinct (styled callout with icon) and clearly separated from explanation/walkthrough
- All three mentor endpoints (analyze, patch, optimize) produce the tip
- Server-side normalization handles missing/malformed tips gracefully
- Works for both English and Chinese content

## Implementation Details

### 1. Data model (`client/src/stores/ide-store.ts`)
- Add `prompt_tip?: string` to the `NotebookFeature` interface

### 2. Mentor prompts (`server/mentor-prompt.ts`)
- In the feature schema of all three prompts (MENTOR_SYSTEM_PROMPT, MENTOR_PATCH_PROMPT, MENTOR_OPTIMIZE_PROMPT), add a `"prompt_tip"` field to each feature object
- Description: "A practical prompt engineering tip teaching the user what prompt to give an AI coding agent to build this specific feature. Start with 'Try this prompt next time when you are building this feature: ...' for English or '下次搭建这个功能时，试试这些提示语: ...' for Chinese. The prompt should be specific, actionable, and detailed enough to produce good results from an AI assistant."
- Add to the CRITICAL rules section: every feature MUST have a non-empty `prompt_tip`

### 3. Server normalization (`server/routes.ts`)
- In `normalizeFeatures()`, ensure `prompt_tip` defaults to empty string if missing (same pattern as `explanation` fallback)

### 4. Frontend UI (`client/src/components/ide/notebook-panel.tsx`)
- In `FeatureCard`, render the `prompt_tip` below the code blocks section when present
- Use a visually distinct callout style: a gradient-tinted box (e.g., violet/purple theme to evoke "AI/prompt" feel) with a `Sparkles` or `Wand2` icon from lucide-react
- The callout should have slightly different styling from the existing walkthrough callout (which uses amber/Lightbulb) to clearly distinguish "code explanation" from "prompt tip"
- Add `data-testid="prompt-tip-{index}"` for testing

## Relevant files
- `client/src/stores/ide-store.ts` — NotebookFeature interface
- `server/mentor-prompt.ts` — all three mentor prompts
- `server/routes.ts` — normalizeFeatures function
- `client/src/components/ide/notebook-panel.tsx` — FeatureCard component
