---
title: "Fix empty feature content in Deep Dive section"
---

# Fix empty feature content in 深度解析 Deep Dive section

## What & Why
When expanding feature cards in the Deep Dive section (e.g., 页面基础结构, 交互控件, 游戏画布), the expanded area is visually empty — no explanation text, no code blocks. The AI model generates features with labels but often omits or returns empty `explanation` and `code_blocks` fields. The frontend renders an empty container with just padding/borders, which looks broken.

## Root Cause
Two contributing factors:
1. **Frontend**: `FeatureCard` renders an empty `<div>` with padding when `explanation` is empty and `code_blocks` is empty/undefined. No fallback or loading state is shown.
2. **AI prompt**: The model sometimes generates features with only labels, skipping the detailed explanation and code blocks despite being instructed to include them. The prompt may need stronger reinforcement or structural examples.

## Done looks like
- Feature cards that have no content (empty explanation + no code blocks) either: (a) display a helpful fallback message like "Detailed explanation is being generated..." or "No detailed analysis available yet", or (b) are not rendered as expandable at all (show label inline without expand affordance).
- Features with partial content (explanation but no code blocks) render the explanation gracefully without an awkward empty code area.
- The mentor prompt is reinforced to more reliably produce feature content, with a concrete example showing the expected output structure.
- Notebooks cached from before the features update gracefully handle missing features data.

## Tasks
1. **Harden FeatureCard rendering** — In `client/src/components/ide/notebook-panel.tsx`, update `FeatureCard` to:
   - Check if the feature has meaningful content (non-empty explanation OR non-empty code_blocks).
   - If no content: either render the label as a non-expandable chip/tag, or show a subtle fallback message when expanded.
   - If only explanation exists (no code_blocks): render explanation without an empty code area.
   
2. **Reinforce mentor prompts** — In `server/mentor-prompt.ts`, add a concrete JSON example of a well-formed feature with explanation and code_blocks inside the schema section of the main prompt. Add an explicit instruction like: "Every feature MUST have a non-empty explanation and at least one code_block. Never return a feature with only a label."

## Relevant files
- `client/src/components/ide/notebook-panel.tsx` (FeatureCard component, lines 64-102)
- `server/mentor-prompt.ts` (all three prompts)
