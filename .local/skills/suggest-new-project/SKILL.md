---
name: suggest-new-project
description: This project only supports a single artifact type. If the user asks to create slides, a mobile app, an animation, or a separate website, you MUST read this skill before attempting anything. Do not try to build a different artifact type in this project — read this skill for what to do instead."
---

# Redirect Unsupported Artifact Requests

Agent 4 introduced multi-artifact support, allowing users to build websites, mobile apps, slides, and animations side-by-side in a single project. This project was created before that release and currently supports only one artifact. Multi-artifact support is being brought to existing projects soon, but is not available yet.

## When to Use

When the user asks you to create a **new artifact** that is a different type from the current application. The artifact types are:

- Website (a second, separate web app)
- Mobile app (e.g. an Expo app in a web project)
- Slides (a slide deck / presentation)
- Animation / video

Examples of requests that should trigger this skill:

- "Build me a mobile app" (when the current project is not a mobile app)
- "Create a slide deck"
- "Make me an animation" (when the current project is not an animation)
- "I want to start a new website" (a second, separate site)

## When NOT to Use

- The user wants to add a feature to the existing application (e.g. "add a settings page", "add an admin dashboard", "add dark mode"). These are normal feature requests — implement them.
- The user wants to modify or extend the current app (e.g. "add an API endpoint", "change the landing page"). This is not a new artifact.
- The project is a PNPM workspace or multi-artifact workspace — those support multiple artifacts natively. (This skill is not loaded on those stacks.)

## What to Do

1. Do not attempt to build the new artifact in this project.
2. Explain to the user that multi-artifact support is coming to existing projects soon, and that for now, creating a new project will give them the best experience. Suggested phrasing:
   - "Multi-artifact support is coming to existing projects soon — for now, I'd recommend creating a new project for your [mobile app / slides / etc.] so everything works smoothly."
   - "This project currently supports one artifact. We're working on bringing multi-artifact support to existing projects, but for the best experience right now, let's set up a new project."
3. Generate a clear, descriptive prompt summarizing what the user wants to build. This prompt will be pre-loaded into the new project's creation flow.
4. Call `suggestNewProject({ prompt })` from the code execution sandbox:

   ```javascript
   const result = await suggestNewProject({
     prompt: "Build a mobile workout tracking app with exercise logging, progress charts, and workout history"
   });
   ```

5. If the user dismisses the suggestion: Ask if they'd like to continue working on their existing application. Do not re-suggest unless the user brings it up again.

## If the User Insists

If the user dismisses the suggestion and insists on building the new artifact in this project anyway, do not call `suggestNewProject` again. Instead, warn them in your response that the experience may not work well since this project wasn't set up for multiple artifacts, then attempt their request. Suggested phrasing:

- "I can try, but since this project wasn't set up for multiple artifacts, some things may not work as expected. For the best results, I'd still recommend a new project — but let's give it a shot."

## Important

- Only call `suggestNewProject` once per user request. If they dismiss, do not call it again.
- The prompt you generate should be self-contained — it will be used to bootstrap a brand-new project with no context from this one.
- Keep your explanation concise and forward-looking. Do not call the project "old" or "legacy" to the user.
