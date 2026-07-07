import { describe, it, expect } from "vitest";
import {
  buildManagerHistory,
  detectLanguage,
  parseCodeBlocks,
  parseCompletionSummary,
  findSummaryHeader,
  splitSummaryBody,
} from "./chat-utils";

/**
 * buildManagerHistory compresses a completed build round into a one-line
 * summary so the manager planner focuses on the user's NEW request instead of
 * re-surfacing the previous round's plan (the "asks about last round's issues"
 * bug). These lock that contract.
 */
describe("buildManagerHistory", () => {
  const u = (content: string) => ({ role: "user", content });
  const a = (content: string, extra: Record<string, unknown> = {}) => ({ role: "assistant", content, ...extra });

  it("passes through history verbatim when there is no completed build", () => {
    const msgs = [u("build a todo app"), a("here's a plan")];
    const out = buildManagerHistory(msgs);
    expect(out).toEqual([
      { role: "user", content: "build a todo app" },
      { role: "assistant", content: "here's a plan" },
    ]);
  });

  it("drops typing placeholders and empty-content messages", () => {
    const msgs = [u("do it"), a("", { typing: true }), a("real reply")];
    const out = buildManagerHistory(msgs);
    expect(out).toEqual([
      { role: "user", content: "do it" },
      { role: "assistant", content: "real reply" },
    ]);
  });

  it("compresses everything up to and including a buildResult into one summary", () => {
    const msgs = [
      u("build a calculator"),
      a("planning the calculator"),
      a("", { buildResult: { changedFiles: ["a.js"] } }), // round 1 done
      u("now add a dark mode toggle"),                      // NEW request
    ];
    const out = buildManagerHistory(msgs);
    // First entry is the compressed summary referencing the previous user ask.
    expect(out[0].role).toBe("assistant");
    expect(out[0].content).toContain("Previous round completed");
    expect(out[0].content).toContain("build a calculator");
    expect(out[0].content).toContain("Changed/touched files: a.js");
    expect(out[0].content).toContain("Preservation constraint");
    expect(out[0].content).toContain("Follow-up discipline");
    // The new request survives verbatim and is the only thing after the summary.
    expect(out.slice(1)).toEqual([{ role: "user", content: "now add a dark mode toggle" }]);
    // Crucially, the old plan text is NOT present — no contamination.
    expect(JSON.stringify(out)).not.toContain("planning the calculator");
  });

  it("carries completed build details forward so the next plan preserves prior work", () => {
    const msgs = [
      u("add inventory and settlement screens"),
      a("", {
        buildResult: {
          completionData: {
            summary: "Implemented inventory drag/drop and extraction settlement.",
            changedFiles: ["/project/index.html", "/project/app.js"],
          },
          segments: [
            { narration: "Built inventory model and loot UI", actions: [], isLive: false },
            { stepLabel: "Step 2/3: Settlement overlay", actions: [], isLive: false },
          ],
        },
      }),
      u("now add enemy patrols"),
    ];

    const out = buildManagerHistory(msgs);

    expect(out[0].content).toContain("Implemented inventory drag/drop and extraction settlement");
    expect(out[0].content).toContain("/project/index.html, /project/app.js");
    expect(out[0].content).toContain("Built inventory model and loot UI");
    expect(out[0].content).toContain("Step 2/3: Settlement overlay");
    expect(out[0].content).toContain("must not delete, rewrite, or regress prior features");
    expect(out[0].content).toContain("avoid full-file rewrites");
    expect(out.slice(1)).toEqual([{ role: "user", content: "now add enemy patrols" }]);
  });

  it("falls back to touched files from actionLog when completion metadata is missing", () => {
    const msgs = [
      u("fix the HUD"),
      a("", {
        buildResult: {
          actionLog: [
            { type: "file_read", label: "/project/index.html", detail: "", timestamp: 1 },
            { type: "file_write", filePath: "/project/styles.css", label: "styles.css", detail: "", timestamp: 2 },
          ],
        },
      }),
      u("make it mobile friendly"),
    ];

    const out = buildManagerHistory(msgs);

    expect(out[0].content).toContain("/project/index.html");
    expect(out[0].content).toContain("/project/styles.css");
    expect(out.slice(1)).toEqual([{ role: "user", content: "make it mobile friendly" }]);
  });

  it("uses the LAST completed round when several builds happened", () => {
    const msgs = [
      u("first feature"),
      a("", { buildResult: {} }),
      u("second feature"),
      a("", { buildResult: {} }), // most recent completed round
      u("third feature"),         // current request
    ];
    const out = buildManagerHistory(msgs);
    expect(out[0].content).toContain("second feature"); // summary anchors on the latest round
    expect(out.slice(1)).toEqual([{ role: "user", content: "third feature" }]);
  });

  it("handles a buildResult as the very last message (no trailing request yet)", () => {
    const msgs = [u("build it"), a("", { buildResult: {} })];
    const out = buildManagerHistory(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain("Previous round completed");
    expect(out[0].content).toContain("build it");
  });

  it("falls back to a generic summary when no prior user message exists", () => {
    const msgs = [a("", { buildResult: {} }), u("new thing")];
    const out = buildManagerHistory(msgs);
    expect(out[0].content).toContain("Previous round completed");
    expect(out.slice(1)).toEqual([{ role: "user", content: "new thing" }]);
  });
});

describe("detectLanguage", () => {
  it("detects Chinese when any CJK char is present", () => {
    expect(detectLanguage("做一个计算器")).toBe("Chinese");
    expect(detectLanguage("build a 计算器")).toBe("Chinese"); // mixed → Chinese
  });
  it("defaults to English for non-CJK text", () => {
    expect(detectLanguage("build a calculator")).toBe("English");
    expect(detectLanguage("")).toBe("English");
  });
});

describe("parseCodeBlocks", () => {
  it("returns the whole string as one text part when there are no file blocks", () => {
    const out = parseCodeBlocks("just some prose");
    expect(out).toEqual(["just some prose"]);
  });

  it("splits a file-tagged fenced block into a CodeBlock with path + language", () => {
    const content = 'before\n```js file="/project/app.js"\nconsole.log(1)\n```\nafter';
    const out = parseCodeBlocks(content);
    expect(out[0]).toBe("before");
    expect(out[1]).toMatchObject({
      language: "js",
      filePath: "/project/app.js",
      code: "console.log(1)",
    });
    expect(out[2]).toBe("after");
  });

  it("defaults language to text when the fence omits it", () => {
    const content = '```  file="/x.txt"\nhi\n```';
    const out = parseCodeBlocks(content);
    expect(out[0]).toMatchObject({ language: "text", filePath: "/x.txt", code: "hi" });
  });
});

describe("parseCompletionSummary", () => {
  it("returns null when no markers are present", () => {
    expect(parseCompletionSummary("plain text, no markers")).toBeNull();
  });

  it("extracts headline, ordered file changes, and special notes", () => {
    const raw = "[HEADLINE]Did the thing[FILE_CHANGE_1]a.js[FILE_CHANGE_2]b.css[SPECIAL_NOTES]watch out";
    const out = parseCompletionSummary(raw)!;
    expect(out.headline).toBe("Did the thing");
    expect(out.fileChanges).toEqual(["a.js", "b.css"]);
    expect(out.specialNotes).toBe("watch out");
  });

  it("stops collecting file changes at the first gap", () => {
    // FILE_CHANGE_1 present, FILE_CHANGE_2 absent → only one collected.
    const out = parseCompletionSummary("[HEADLINE]x[FILE_CHANGE_1]only")!;
    expect(out.fileChanges).toEqual(["only"]);
  });
});

describe("findSummaryHeader", () => {
  it("locates a known English summary header", () => {
    const text = "intro line\nHere's what I did:\n- a";
    const res = findSummaryHeader(text)!;
    expect(res).not.toBeNull();
    expect(text.slice(res.index, res.index + res.length)).toBe("Here's what I did:");
  });
  it("returns null when no header is present", () => {
    expect(findSummaryHeader("nothing notable here")).toBeNull();
  });
});

describe("splitSummaryBody", () => {
  it("returns the whole text as body when there are no bullets", () => {
    expect(splitSummaryBody("no bullets here")).toEqual({ body: "no bullets here", trailing: "" });
  });

  it("splits trailing prose after a bullet block", () => {
    const text = "- one\n- two\nWrapping up the work.";
    const { body, trailing } = splitSummaryBody(text);
    expect(body).toBe("- one\n- two");
    expect(trailing).toBe("Wrapping up the work.");
  });

  it("keeps everything as body when bullets run to the end", () => {
    const text = "- one\n- two";
    expect(splitSummaryBody(text)).toEqual({ body: text, trailing: "" });
  });
});
