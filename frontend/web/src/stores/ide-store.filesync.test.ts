import { describe, expect, it } from "vitest";
import {
  getUnsafeFullFileSyncReason,
  isDefaultProjectFileSet,
  type FileNode,
} from "./ide-store";

const starterFiles: FileNode[] = [
  {
    name: "project",
    path: "/project",
    type: "folder",
    children: [
      {
        name: "index.html",
        path: "/project/index.html",
        type: "file",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <script src="app.js"></script>
</body>
</html>`,
      },
      { name: "style.css", path: "/project/style.css", type: "file", content: "" },
      { name: "app.js", path: "/project/app.js", type: "file", content: "" },
      {
        name: "cascade.md",
        path: "/project/cascade.md",
        type: "file",
        content: `# cascade.md

## Overview

_Generated after planning is complete._

## User Preferences

_Populated after the first plan is created._

## System Architecture

_Populated after the first plan is created._

## External Dependencies

_Populated after the first plan is created._
`,
      },
    ],
  },
];

const realFiles: FileNode[] = [
  {
    name: "project",
    path: "/project",
    type: "folder",
    children: [
      {
        name: "index.html",
        path: "/project/index.html",
        type: "file",
        content: "<html><body>real app</body></html>",
      },
    ],
  },
];

describe("project file full-sync safety", () => {
  it("detects the frontend starter template file tree", () => {
    expect(isDefaultProjectFileSet(starterFiles)).toBe(true);
    expect(isDefaultProjectFileSet(realFiles)).toBe(false);
  });

  it("blocks empty or starter-template full sync unless explicitly destructive", () => {
    expect(getUnsafeFullFileSyncReason([])).toBe("empty");
    expect(getUnsafeFullFileSyncReason(starterFiles)).toBe("starter-template");
    expect(getUnsafeFullFileSyncReason(realFiles)).toBeNull();

    expect(getUnsafeFullFileSyncReason([], { allowDestructiveOverwrite: true })).toBeNull();
    expect(getUnsafeFullFileSyncReason(starterFiles, { allowDestructiveOverwrite: true })).toBeNull();
  });
});
