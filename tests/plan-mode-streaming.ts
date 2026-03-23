/**
 * Plan-mode manager-chat server-side streaming validation.
 *
 * This script validates that /api/manager-chat streams raw_token events
 * progressively (per-token), not as a single burst after a long delay.
 *
 * Facts about latency:
 *   - Doubao AI endpoint: ark.cn-beijing.volces.com (Beijing)
 *   - Expected first-token latency from validation host: 5-18s
 *   - FIRST_TOKEN_MAX_MS is set to 30s to account for network variance from validation host
 *   - Once tokens start, they should arrive over ≥500ms (proving progressive)
 *   - Total stream completes within 60s
 *
 * The companion e2e test (tests/plan-mode-streaming.e2e.ts) covers UI-level
 * assertions using Playwright.
 */

import http from "http";

const BASE_URL = "http://localhost:5000";
const FIRST_TOKEN_MAX_MS = 30_000;
const COMPLETION_MAX_MS = 60_000;
const MIN_TOKENS = 5;
const MIN_STREAM_SPAN_MS = 500;

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
            reject(new Error(
              `No raw_token within ${FIRST_TOKEN_MAX_MS}ms — ` +
              `server may still be buffering (nginx/compression issue)`
            ));
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
            reject(new Error("Stream ended without any raw_token events"));
          } else {
            resolve({ firstTokenMs, lastTokenMs, totalMs: Date.now() - startMs, tokenCount, seenManagerDone });
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
  console.log("=== Plan-mode /api/manager-chat streaming (server-side) ===\n");

  let projectId: string | null = null;
  const results: boolean[] = [];

  try {
    console.log("[1] Creating blank project (no files = plan mode)...");
    const uid = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = await postJson("/api/projects", { id: uid, name: "__streaming_test__" });
    const proj = (created.project as { id: string } | undefined);
    if (!proj?.id) throw new Error(`Unexpected response: ${JSON.stringify(created)}`);
    projectId = proj.id;
    console.log(`    Project: ${projectId}\n`);

    console.log(`[2] Streaming /api/manager-chat (AI latency to Beijing: 5-18s)...`);
    const r = await streamManagerChat(projectId);

    console.log(`    First raw_token:   ${r.firstTokenMs}ms`);
    console.log(`    Last  raw_token:   ${r.lastTokenMs}ms`);
    console.log(`    Token stream span: ${r.lastTokenMs - r.firstTokenMs}ms`);
    console.log(`    Total tokens:      ${r.tokenCount}`);
    console.log(`    Total duration:    ${r.totalMs}ms`);
    console.log(`    manager_done:      ${r.seenManagerDone}\n`);

    console.log("[3] Assertions:");
    results.push(check(
      `First token within ${FIRST_TOKEN_MAX_MS / 1000}s`,
      r.firstTokenMs <= FIRST_TOKEN_MAX_MS,
      `${r.firstTokenMs}ms`
    ));
    results.push(check(
      `Progressive streaming (≥${MIN_TOKENS} tokens)`,
      r.tokenCount >= MIN_TOKENS,
      `${r.tokenCount} tokens`
    ));
    results.push(check(
      `Token span ≥${MIN_STREAM_SPAN_MS}ms (not all-at-once)`,
      r.lastTokenMs - r.firstTokenMs >= MIN_STREAM_SPAN_MS,
      `${r.lastTokenMs - r.firstTokenMs}ms`
    ));
    results.push(check(
      `Completes within ${COMPLETION_MAX_MS / 1000}s`,
      r.totalMs <= COMPLETION_MAX_MS,
      `${r.totalMs}ms`
    ));
    results.push(check(
      "manager_done event received",
      r.seenManagerDone,
      r.seenManagerDone ? "yes" : "missing"
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
