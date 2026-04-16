# Fix: hide raw code blocks from chat display

## What & Why
When the Build AI writes files, its response contains code fences
(```lang\n...\n```) that don't match the `file="..."` pattern.
These fall through to the text renderer and appear as raw ``` characters.
The user should never see code — it should be silently stripped.

## Done looks like
- No raw ``` code fences visible in any chat message
- The file-write card (collapsible CodeBlockView with file="...") is unaffected

## Implementation — minimal change
In `parseCodeBlocks` (`client/src/components/ide/chat-panel.tsx`, ~line 129):

The function already splits content on `file="..."` code blocks.
The leftover string segments are passed to `TextWithSummary` which
renders them verbatim, including any stray ``` fences.

**Fix:** after splitting on the `file=` regex, strip any remaining plain
code fences from the string segments before returning them:

```ts
// inside parseCodeBlocks, when pushing a trailing/between string:
const stripped = segment.replace(/```[\w]*\n[\s\S]*?```/g, "").trim();
if (stripped) parts.push(stripped);
```

Apply the same strip to every string segment pushed into `parts`.

## Relevant files
- `client/src/components/ide/chat-panel.tsx` — `parseCodeBlocks` (~line 129)
