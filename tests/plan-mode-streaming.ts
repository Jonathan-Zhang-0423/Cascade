/**
 * Plan-mode streaming validation test.
 *
 * Tests that /api/manager-chat emits raw_token SSE events progressively
 * (not all-at-once after a long delay).
 *
 * UI-level assertions (typing indicator visible, text rendering progressively)
 * are validated separately via Playwright e2e tests (runTest).
 * This script validates the SERVER-SIDE streaming guarantee:
 *   - First raw_token arrives within FIRST_TOKEN_TIMEOUT_MS of the request
 *   - Multiple tokens received (not a single all-at-once dump)
 */
import http from "http";

const BASE_URL = "http://localhost:5000";
/** Max ms from request start to first raw_token. Accounts for Doubao API latency. */
const FIRST_TOKEN_TIMEOUT_MS = 15000;
/** Max ms to wait for [DONE] before giving up. */
const DONE_TIMEOUT_MS = 120000;
/** Minimum number of raw_token events to confirm progressive streaming. */
const MIN_TOKEN_COUNT = 3;

async function createProject(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name });
    const req = http.request(
      `${BASE_URL}/api/projects`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).id);
          } catch {
            reject(new Error(`createProject parse failed: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function deleteProject(id: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(
      `${BASE_URL}/api/projects/${id}`,
      { method: "DELETE" },
      () => resolve()
    );
    req.on("error", () => resolve());
    req.end();
  });
}

function testManagerChatStreaming(
  projectId: string
): Promise<{ firstTokenMs: number; tokenCount: number }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
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
          "Content-Length": Buffer.byteLength(body),
          Accept: "text/event-stream",
        },
      },
      (res) => {
        const startMs = Date.now();
        let firstTokenMs = -1;
        let tokenCount = 0;
        let buf = "";
        let done = false;

        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            res.destroy();
            if (tokenCount === 0) {
              reject(new Error(`Timed out: no raw_token in ${DONE_TIMEOUT_MS}ms`));
            } else {
              resolve({ firstTokenMs, tokenCount });
            }
          }
        }, DONE_TIMEOUT_MS);

        const firstTokenTimer = setTimeout(() => {
          if (!done && tokenCount === 0) {
            done = true;
            clearTimeout(timer);
            res.destroy();
            reject(
              new Error(
                `No raw_token within ${FIRST_TOKEN_TIMEOUT_MS}ms — streaming may be blocked`
              )
            );
          }
        }, FIRST_TOKEN_TIMEOUT_MS);

        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearTimeout(firstTokenTimer);
          res.destroy();
          if (firstTokenMs === -1) {
            reject(new Error("Stream ended without any raw_token"));
          } else {
            resolve({ firstTokenMs, tokenCount });
          }
        };

        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") {
              finish();
              return;
            }
            try {
              const ev = JSON.parse(raw);
              if (ev.type === "raw_token") {
                tokenCount++;
                if (firstTokenMs === -1) {
                  firstTokenMs = Date.now() - startMs;
                  clearTimeout(firstTokenTimer);
                }
              }
            } catch {}
          }
        });

        res.on("error", (e) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            clearTimeout(firstTokenTimer);
            reject(e);
          }
        });
        res.on("end", () => finish());
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log("=== Plan-mode /api/manager-chat streaming validation ===");

  let projectId: string | null = null;
  let passed = true;

  try {
    console.log("1. Creating blank test project (no files = plan mode)...");
    projectId = await createProject("__streaming_test__");
    console.log(`   Project ID: ${projectId}`);

    console.log("2. Sending message to /api/manager-chat (SSE)...");
    const { firstTokenMs, tokenCount } = await testManagerChatStreaming(projectId);

    console.log(`   First raw_token latency: ${firstTokenMs}ms`);
    console.log(`   Total raw_tokens received: ${tokenCount}`);

    if (firstTokenMs > FIRST_TOKEN_TIMEOUT_MS) {
      console.error(
        `FAIL: First token at ${firstTokenMs}ms exceeds ${FIRST_TOKEN_TIMEOUT_MS}ms threshold`
      );
      passed = false;
    } else {
      console.log(`PASS: First token within ${FIRST_TOKEN_TIMEOUT_MS}ms threshold`);
    }

    if (tokenCount < MIN_TOKEN_COUNT) {
      console.error(
        `FAIL: Only ${tokenCount} tokens — need at least ${MIN_TOKEN_COUNT} for progressive streaming`
      );
      passed = false;
    } else {
      console.log(`PASS: ${tokenCount} tokens received (streaming is progressive)`);
    }
  } catch (err: any) {
    console.error("FAIL:", err?.message ?? String(err));
    passed = false;
  } finally {
    if (projectId) {
      await deleteProject(projectId);
      console.log("Cleanup: test project deleted.");
    }
  }

  if (!passed) process.exit(1);
  console.log("=== All server-side streaming checks passed ===");
}

run();
