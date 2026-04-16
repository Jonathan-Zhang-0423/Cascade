# Mentor Agent: Strict Plain Language Rule

## What & Why
The mentor agent's explanations still use technical terms without immediately explaining them, which can overwhelm complete beginners. A strict rule must be added across all three mentor prompts (main, patch, optimize) so that every single technical term is immediately followed by a plain-language explanation in parentheses or a short phrase. The target audience is someone with zero coding experience — explanations should be understandable by a 5-year-old.

This is a foundational rule that applies across the board to all mentor agent output, not just mind map child nodes.

## Done looks like
- All three mentor prompts (MENTOR_SYSTEM_PROMPT, MENTOR_PATCH_PROMPT, MENTOR_OPTIMIZE_PROMPT) include a prominent, strict rule: "Every technical term MUST be immediately followed by a plain-language explanation. Never leave a technical word unexplained."
- The rule includes concrete examples showing the before/after (e.g., "Don't say 'DOM manipulation'. Say 'DOM manipulation (changing what you see on the page)'").
- The rule applies globally to all output fields: project_summary, file breakdowns, mind map descriptions, mind map child explanations, key concepts, and learning tips.
- Existing guidance about "explain like I'm 5" and "no jargon" is strengthened with this explicit requirement.

## Out of scope
- Changes to the mind map visual layout or tooltip rendering.
- Changes to any frontend code.

## Tasks
1. **Add the plain-language rule to MENTOR_SYSTEM_PROMPT** — Add a new top-level rule (high priority position) that mandates every technical term be immediately followed by a beginner-friendly explanation. Include 3-4 concrete before/after examples. Strengthen existing "explain like I'm 5" rule to reinforce this.

2. **Add the same rule to MENTOR_PATCH_PROMPT and MENTOR_OPTIMIZE_PROMPT** — Mirror the rule in both prompts so incremental updates and optimizations also follow the same standard.

## Relevant files
- `server/mentor-prompt.ts`
