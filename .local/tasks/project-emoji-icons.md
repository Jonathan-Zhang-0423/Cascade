# Project Emoji Icons on Dashboard

## What & Why
Each project card on the dashboard currently shows a generic `<Code2>` icon. This feature replaces it with a relevant emoji automatically chosen from the project's name/description — so a space game shows 🚀, a snake game shows 🐍, a portfolio shows 🎨, etc. This makes the dashboard feel alive and personal without any extra effort from the user.

## Done looks like
- Every project card shows a large emoji in the icon box instead of the Code2 icon
- The emoji is chosen at project-creation time based on the idea text typed by the user
- Existing projects (already in localStorage with no emoji stored) automatically get an emoji derived from their name at display time — they do not need to be recreated
- The emoji is stored alongside the project so it survives renaming (renaming doesn't change the emoji)
- The mapping is broad and covers: games (snake, chess, tetris, space, RPG, etc.), web types (portfolio, blog, todo, weather, chat, quiz, e-commerce, etc.), utilities (calculator, timer, calendar, converter), creative topics (music, art, stories), and a smart fallback for unrecognized projects

## Out of scope
- Letting users manually choose or change their project emoji (future work)
- Using AI to assign the emoji (pure keyword matching is sufficient and instant)

## Tasks
1. **Add `emoji` field to `ProjectEntry` and update `createProject`** — Add an optional `emoji: string` field to the `ProjectEntry` type. Update the `createProject` action to accept an `emoji` parameter and store it in the projects array.

2. **Create `project-emoji.ts` utility** — Write a `getProjectEmoji(text: string): string` function with comprehensive keyword→emoji mappings. The function should normalize the text (lowercase, trim), then test against an ordered list of keyword patterns (regex or includes checks). Cover: space/rocket games, snake, chess, tetris, pac-man, cards/poker, RPG/dungeon, racing, puzzle, platformer, fighting; portfolio/resume, blog, todo/task, weather, chat/messaging, quiz/trivia, e-commerce/shop, music player, calendar/schedule, calculator, timer/stopwatch, drawing/canvas, story/book, typing/keyboard, map; and a sensible fallback emoji (💻). Mappings should check both English and Chinese keywords since the app supports both.

3. **Wire emoji into the dashboard** — On the "Let's Go!" create flow in `dashboard.tsx`, call `getProjectEmoji(ideaText)` and pass the result to `createProject`. In the project card render, display `project.emoji ?? getProjectEmoji(project.name)` as a text element inside the existing rounded box (replacing the `Code2` icon). Size the emoji at ~text-2xl so it fills the 40×40 box naturally.

## Relevant files
- `client/src/stores/project-store.ts:1-15,142-184`
- `client/src/pages/dashboard.tsx:143-190`
