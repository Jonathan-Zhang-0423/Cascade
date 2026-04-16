# On-Demand Agent Skill Library

## What & Why
Today, all knowledge the Manager and Editor agents have lives permanently in their system prompts. Framework-specific guidance (React patterns, Python idioms, Node.js conventions) is either absent or bloating the prompt with content irrelevant to most projects.

This task introduces a **Skill Library** modeled on the s05 pattern from learn-claude-code: a directory of SKILL.md files per project type/technology, loaded on demand. When the Manager identifies a project type (e.g. "React app" or "Flask API"), it loads the relevant skill and injects it as context — not upfront, only when needed.

The result: agents get sharp, relevant expertise exactly when they need it, without wasting tokens on irrelevant content.

## Done looks like
- A `server/skills/` directory exists with SKILL.md files covering common project types: `react`, `node-express`, `python-flask`, `vanilla-js`, `python-cli`
- Each SKILL.md contains concise, actionable guidance: project structure conventions, common patterns, pitfalls to avoid, and idiomatic code style
- The Manager Agent detects the project type from the user's request and injects the matching skill content into its context before planning
- The Editor Agent receives the relevant skill content alongside each build step so generated code follows the right conventions
- Skills are loaded lazily — not injected into the system prompt, but appended to the relevant message when first needed

## Out of scope
- A UI for browsing or managing skills
- User-defined custom skills
- Skill versioning or update mechanisms

## Tasks
1. **Create the skill library** — Build `server/skills/` with a SKILL.md for each of the 5 core project types. Each file should include: recommended project structure, idiomatic patterns, common pitfalls, and a short code style guide relevant to that technology.

2. **Build the SkillLoader utility** — Create `server/skill-loader.ts` that scans the skills directory, exposes a list of available skill names and descriptions, and a `loadSkill(name)` function that returns the full SKILL.md content.

3. **Integrate into Manager Agent** — In the `/api/manager-chat` route, after the Manager identifies a project type (detectable from early messages), call `loadSkill()` and append the skill content to the system message or inject it as an additional context block before the LLM call.

4. **Integrate into Editor Agent** — In `build-orchestrator.ts`, detect the project type from the plan and pass the skill content into each Editor call's prompt context, so generated code follows the right conventions throughout the build.

## Relevant files
- `server/routes.ts`
- `server/build-orchestrator.ts`
- `server/manager-prompt.ts`
- `server/editor-prompt.ts`
