import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { BuildTelemetry } from "../telemetry";

describe("AG-17 BuildTelemetry", () => {
  let tmp: string;
  let savedDir: string | undefined;
  let savedDisable: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "telemetry-test-"));
    savedDir = process.env.TELEMETRY_DIR;
    savedDisable = process.env.DISABLE_TELEMETRY;
    process.env.TELEMETRY_DIR = tmp;
    delete process.env.DISABLE_TELEMETRY;
  });

  afterEach(async () => {
    if (savedDir === undefined) delete process.env.TELEMETRY_DIR;
    else process.env.TELEMETRY_DIR = savedDir;
    if (savedDisable === undefined) delete process.env.DISABLE_TELEMETRY;
    else process.env.DISABLE_TELEMETRY = savedDisable;
    await rm(tmp, { recursive: true, force: true });
  });

  it("initializes with zeroed counters and session metadata", () => {
    const t = new BuildTelemetry({ id: "sess-1", framework: "web", provider: "doubao" });
    const snap = t.snapshot();
    expect(snap.sessionId).toBe("sess-1");
    expect(snap.framework).toBe("web");
    expect(snap.provider).toBe("doubao");
    expect(snap.writeFileCount).toBe(0);
    expect(snap.hashPatchFileCount).toBe(0);
    expect(snap.filesWritten).toEqual([]);
    expect(snap.finalStatus).toBe("error");
  });

  it("updates counters and file lists via incr/addFileWritten", () => {
    const t = new BuildTelemetry({ id: "s" });
    t.incr("writeFileCount");
    t.incr("writeFileCount");
    t.incr("hashPatchFileCount");
    t.incr("hashPatchMissCount");
    t.addFileWritten("/project/a.ts");
    t.addFileWritten("/project/a.ts"); // dedup
    t.addFileWritten("/project/b.ts");
    t.incrLspErrors(3);

    const snap = t.snapshot();
    expect(snap.writeFileCount).toBe(2);
    expect(snap.hashPatchFileCount).toBe(1);
    expect(snap.hashPatchMissCount).toBe(1);
    expect(snap.filesWritten.sort()).toEqual(["/project/a.ts", "/project/b.ts"]);
    expect(snap.lspDiagnosticErrorCount).toBe(3);
  });

  it("records phase timing via time()", async () => {
    const t = new BuildTelemetry({ id: "s" });
    await t.time("builder", async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
    const snap = t.snapshot();
    expect(snap.timings.builder).toBeGreaterThanOrEqual(10);
  });

  it("flush() appends one JSON line to dated file", async () => {
    const t = new BuildTelemetry({ id: "sess-flush", framework: "flutter" });
    t.setFinalStatus("pass", "ok");
    t.setFixCycle(1);
    await t.flush();

    const files = await readdir(tmp);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^sessions-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const content = await readFile(path.join(tmp, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.sessionId).toBe("sess-flush");
    expect(parsed.finalStatus).toBe("pass");
    expect(parsed.verifierFirstPassed).toBe(true);
  });

  it("flush() honors DISABLE_TELEMETRY and writes nothing", async () => {
    process.env.DISABLE_TELEMETRY = "1";
    const t = new BuildTelemetry({ id: "sess-disabled" });
    await t.flush();
    const files = await readdir(tmp);
    expect(files).toEqual([]);
  });

  it("is idempotent — double flush() writes only one line", async () => {
    const t = new BuildTelemetry({ id: "sess-dup" });
    await t.flush();
    await t.flush();
    const files = await readdir(tmp);
    const content = await readFile(path.join(tmp, files[0]), "utf-8");
    expect(content.trim().split("\n").length).toBe(1);
  });
});
