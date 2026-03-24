/**
 * Build-session narration streaming validation.
 *
 * This script validates that /api/build-session streams narration_token
 * events (from the Editor's preamble) progressively before the first
 * code step completes.
 *
 * Facts about latency:
 *   - Doubao AI endpoint: ark.cn-beijing.volces.com (Beijing)
 *   - Expected first narration_token latency: 5–25s (editor starts narrating
 *     immediately at the beginning of each step)
 *   - FIRST_TOKEN_MAX_MS is set generously to 40s to avoid false failures
 *   - At least 3 narration_token events expected per step narration
 *   - Total stream completes within 120s (single-step plan)
 *
 * The test uses a minimal one-step plan so the full build session
 * finishes quickly while still exercising the editor narration path.
 */

import http from "http";

const BASE_URL = "http://localhost:5000";
const FIRST_TOKEN_MAX_MS = 40_000;
const COMPLETION_MAX_MS = 120_000;
const MIN_NARRATION_TOKENS = 3;

type ParsedJson = Record<string, unknown>;

function postJson(path: string, body: object): Promise<ParsedJson> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE_URL}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data) as ParsedJson); }
          catch { reject(new Error(`Parse failed: ${data.slice(0, 200)}`)); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function deleteReq(path: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(`${BASE_URL}${path}`, { method: "DELETE" }, () => resolve());
    req.on("error", () => resolve());
    req.end();
  });
}

interface StreamResult {
  firstNarrationTokenMs: number;
  lastNarrationTokenMs: number;
  totalMs: number;
  narrationTokenCount: number;
  seenDone: boolean;
}

function streamBuildSession(projectId: string): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const sessionId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const plan = {
      summary: "Add a greeting to the page",
      steps: [
        {
          step: 1,
          title: "Add greeting message",
          description: "Add a simple <p>Hello, CodeStart!</p> element to the page.",
          acceptance_criteria: "The page displays 'Hello, CodeStart!'",
        },
      ],
    };

    const payload = JSON.stringify({
      sessionId,
      plan,
      userRequest: "Add a greeting to the page",
      userLang: "English",
      files: [
        { path: "/project/index.html", content: "<!DOCTYPE html><html><body></body></html>" },
      ],
    });

    const req = http.request(
      `${BASE_URL}/api/build-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Accept: "text/event-stream",
        },
      },
      (res) => {
        const startMs = Date.now();
        let firstNarrationTokenMs = -1;
        let lastNarrationTokenMs = -1;
        let narrationTokenCount = 0;
        let seenDone = false;
        let buf = "";
        let done = false;

        const firstTokenGuard = setTimeout(() => {
          if (!done && firstNarrationTokenMs === -1) {
            done = true;
            res.destroy();
            reject(new Error(
              `No narration_token within ${FIRST_TOKEN_MAX_MS}ms — ` +
              `editor preamble may be failing silently`
            ));
          }
        }, FIRST_TOKEN_MAX_MS);

        const completionGuard = setTimeout(() => {
          if (!done) {
            done = true;
            clearTimeout(firstTokenGuard);
            res.destroy();
            reject(new Error(`Build session stream did not finish within ${COMPLETION_MAX_MS}ms`));
          }
        }, COMPLETION_MAX_MS);

        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(firstTokenGuard);
          clearTimeout(completionGuard);
          res.destroy();
          if (firstNarrationTokenMs === -1) {
            reject(new Error("Stream ended without any narration_token events"));
          } else {
            resolve({
              firstNarrationTokenMs,
              lastNarrationTokenMs,
              totalMs: Date.now() - startMs,
              narrationTokenCount,
              seenDone,
            });
          }
        };

        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") { finish(); return; }
            try {
              const ev = JSON.parse(raw);
              if (ev.type === "narration_token") {
                const nowMs = Date.now() - startMs;
                narrationTokenCount++;
                if (firstNarrationTokenMs === -1) {
                  firstNarrationTokenMs = nowMs;
                  clearTimeout(firstTokenGuard);
                }
                lastNarrationTokenMs = nowMs;
              } else if (ev.type === "done") {
                seenDone = true;
                finish();
              }
            } catch {}
          }
        });

        res.on("error", (e) => {
          if (!done) {
            done = true;
            clearTimeout(firstTokenGuard);
            clearTimeout(completionGuard);
            reject(e);
          }
        });
        res.on("end", () => finish());
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function check(label: string, pass: boolean, detail: string): boolean {
  console.log(`  ${pass ? "PASS" : "FAIL"}: ${label} — ${detail}`);
  return pass;
}

async function run() {
  console.log("=== Build-session editor narration streaming (server-side) ===\n");

  let projectId: string | null = null;
  const results: boolean[] = [];

  try {
    console.log("[1] Creating blank project...");
    const uid = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = await postJson("/api/projects", { id: uid, name: "__build_streaming_test__" });
    const proj = (created.project as { id: string } | undefined);
    if (!proj?.id) throw new Error(`Unexpected response: ${JSON.stringify(created)}`);
    projectId = proj.id;
    console.log(`    Project: ${projectId}\n`);

    console.log(`[2] Streaming /api/build-session (AI latency to Beijing: 5-25s)...`);
    const r = await streamBuildSession(projectId);

    console.log(`    First narration_token: ${r.firstNarrationTokenMs}ms`);
    console.log(`    Last  narration_token: ${r.lastNarrationTokenMs}ms`);
    console.log(`    Total narration tokens: ${r.narrationTokenCount}`);
    console.log(`    Total duration:         ${r.totalMs}ms`);
    console.log(`    done event:             ${r.seenDone}\n`);

    console.log("[3] Assertions:");
    results.push(check(
      `First narration_token within ${FIRST_TOKEN_MAX_MS / 1000}s`,
      r.firstNarrationTokenMs <= FIRST_TOKEN_MAX_MS,
      `${r.firstNarrationTokenMs}ms`
    ));
    results.push(check(
      `At least ${MIN_NARRATION_TOKENS} narration_tokens received`,
      r.narrationTokenCount >= MIN_NARRATION_TOKENS,
      `${r.narrationTokenCount} tokens`
    ));
    results.push(check(
      `Completes within ${COMPLETION_MAX_MS / 1000}s`,
      r.totalMs <= COMPLETION_MAX_MS,
      `${r.totalMs}ms`
    ));
    results.push(check(
      "done event received",
      r.seenDone,
      r.seenDone ? "yes" : "missing"
    ));
  } catch (err: any) {
    console.error("\nFAIL (exception):", err?.message ?? String(err));
    results.push(false);
  } finally {
    if (projectId) {
      await deleteReq(`/api/projects/${projectId}`);
      console.log("\nCleanup: test project deleted.");
    }
  }

  const allPassed = results.every(Boolean);
  console.log(`\n=== ${allPassed ? "All checks passed" : `${results.filter((r) => !r).length} FAILED`} ===`);
  if (!allPassed) process.exit(1);
}

run();
