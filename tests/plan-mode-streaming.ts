/**
 * Plan-mode manager-chat streaming validation.
 *
 * Verifies that /api/manager-chat streams raw_token events progressively —
 * i.e. tokens arrive spread over time, NOT all delivered in one burst after
 * a long silence (which was the pre-fix behaviour caused by server-side JSON
 * pattern accumulation).
 *
 * Key facts about this stack:
 *  - UI typing indicator: injected by the FRONTEND immediately on send (0ms).
 *    Not dependent on AI response time. Cannot be verified here.
 *  - First raw_token: depends on Doubao AI latency (~8-15s from this host to
 *    Beijing). Threshold is intentionally lenient (15s) to avoid flaky results.
 *  - Progressive streaming proof: once tokens start, they should arrive
 *    spread across several seconds (not all within 1s), proving the server
 *    is not buffering and then dumping them in a single write.
 *  - Completion: the full stream must finish within 60s.
 *
 * UI-level assertions (typing indicator timing, rendered text) are validated
 * by the Playwright runTest suite run during development.
 */

import http from "http";

const BASE_URL = "http://localhost:5000";
const FIRST_TOKEN_MAX_MS = 15_000;
const COMPLETION_MAX_MS = 60_000;
const MIN_TOKENS = 5;
/** Progressive streaming: span between first and last token must exceed this. */
const MIN_STREAM_SPAN_MS = 500;

type ParsedResponse = Record<string, unknown>;

function postJson(path: string, body: object): Promise<ParsedResponse> {
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
          try {
            resolve(JSON.parse(data) as ParsedResponse);
          } catch {
            reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`));
          }
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
  firstTokenMs: number;
  lastTokenMs: number;
  totalMs: number;
  tokenCount: number;
  seenManagerDone: boolean;
}

function streamManagerChat(projectId: string): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      messages: [{ role: "user", content: "I want to build a simple calculator" }],
      projectId,
      isFirstMessage: true,
      existingFiles: [],
    });

    const req = http.request(
      `${BASE_URL}/api/manager-chat`,
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
        let firstTokenMs = -1;
        let lastTokenMs = -1;
        let tokenCount = 0;
        let seenManagerDone = false;
        let buf = "";
        let done = false;

        const firstTokenGuard = setTimeout(() => {
          if (!done && firstTokenMs === -1) {
            done = true;
            res.destroy();
            reject(
              new Error(
                `No raw_token within ${FIRST_TOKEN_MAX_MS}ms — likely server-side buffering`
              )
            );
          }
        }, FIRST_TOKEN_MAX_MS);

        const completionGuard = setTimeout(() => {
          if (!done) {
            done = true;
            clearTimeout(firstTokenGuard);
            res.destroy();
            reject(new Error(`Stream did not finish within ${COMPLETION_MAX_MS}ms`));
          }
        }, COMPLETION_MAX_MS);

        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(firstTokenGuard);
          clearTimeout(completionGuard);
          res.destroy();
          if (firstTokenMs === -1) {
            reject(new Error("Stream ended with no raw_token events"));
          } else {
            resolve({
              firstTokenMs,
              lastTokenMs,
              totalMs: Date.now() - startMs,
              tokenCount,
              seenManagerDone,
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
              if (ev.type === "raw_token") {
                const nowMs = Date.now() - startMs;
                tokenCount++;
                if (firstTokenMs === -1) {
                  firstTokenMs = nowMs;
                  clearTimeout(firstTokenGuard);
                }
                lastTokenMs = nowMs;
              } else if (ev.type === "manager_done") {
                seenManagerDone = true;
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
  console.log("=== Plan-mode /api/manager-chat streaming validation ===\n");

  let projectId: string | null = null;
  const results: boolean[] = [];

  try {
    console.log("[1] Creating blank project (no files = plan mode)...");
    const testId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = await postJson("/api/projects", { id: testId, name: "__streaming_test__" });
    const projectObj = created.project as { id: string } | undefined;
    if (!projectObj?.id) throw new Error(`Unexpected create-project response: ${JSON.stringify(created)}`);
    projectId = projectObj.id;
    console.log(`    Created project: ${projectId}\n`);

    console.log("[2] Streaming /api/manager-chat (this may take 8-15s for first AI token)...");
    const r = await streamManagerChat(projectId);

    console.log(`    First raw_token: ${r.firstTokenMs}ms`);
    console.log(`    Last  raw_token: ${r.lastTokenMs}ms`);
    console.log(`    Token stream span: ${r.lastTokenMs - r.firstTokenMs}ms`);
    console.log(`    Total tokens: ${r.tokenCount}`);
    console.log(`    Total duration: ${r.totalMs}ms`);
    console.log(`    manager_done seen: ${r.seenManagerDone}\n`);

    console.log("[3] Assertions:");
    results.push(check(
      "First token within 15s (API latency budget)",
      r.firstTokenMs <= FIRST_TOKEN_MAX_MS,
      `${r.firstTokenMs}ms / ${FIRST_TOKEN_MAX_MS}ms`
    ));
    results.push(check(
      `Progressive streaming (≥${MIN_TOKENS} tokens received)`,
      r.tokenCount >= MIN_TOKENS,
      `${r.tokenCount} tokens`
    ));
    results.push(check(
      `Tokens span ≥${MIN_STREAM_SPAN_MS}ms (not all-at-once burst)`,
      r.lastTokenMs - r.firstTokenMs >= MIN_STREAM_SPAN_MS,
      `span=${r.lastTokenMs - r.firstTokenMs}ms`
    ));
    results.push(check(
      `Complete within ${COMPLETION_MAX_MS / 1000}s`,
      r.totalMs <= COMPLETION_MAX_MS,
      `${r.totalMs}ms`
    ));
    results.push(check(
      "manager_done event received",
      r.seenManagerDone,
      r.seenManagerDone ? "yes" : "missing — stream may be truncated"
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
  const failCount = results.filter((r) => !r).length;
  console.log(`\n=== ${allPassed ? "All checks passed" : `${failCount} FAILED`} ===`);
  if (!allPassed) process.exit(1);
}

run();
