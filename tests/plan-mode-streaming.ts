import http from "http";

const BASE_URL = "http://localhost:5000";
const FIRST_TOKEN_TIMEOUT_MS = 8000;
const DONE_TIMEOUT_MS = 90000;

async function createProject(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name });
    const req = http.request(
      `${BASE_URL}/api/projects`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data).id); } catch { reject(new Error(`createProject parse failed: ${data}`)); }
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
    const req = http.request(`${BASE_URL}/api/projects/${id}`, { method: "DELETE" }, () => resolve());
    req.on("error", () => resolve());
    req.end();
  });
}

function testManagerChatStreaming(projectId: string): Promise<{ firstTokenMs: number; tokenCount: number }> {
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
        let timer: ReturnType<typeof setTimeout>;

        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          res.destroy();
          if (firstTokenMs === -1) {
            reject(new Error(`No raw_token received within ${FIRST_TOKEN_TIMEOUT_MS}ms`));
          } else {
            resolve({ firstTokenMs, tokenCount });
          }
        };

        timer = setTimeout(() => {
          if (tokenCount === 0) {
            done = true;
            res.destroy();
            reject(new Error(`Timed out: no raw_token in ${FIRST_TOKEN_TIMEOUT_MS}ms`));
          } else {
            finish();
          }
        }, DONE_TIMEOUT_MS);

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
                tokenCount++;
                if (firstTokenMs === -1) {
                  firstTokenMs = Date.now() - startMs;
                  if (firstTokenMs > FIRST_TOKEN_TIMEOUT_MS) {
                    done = true;
                    clearTimeout(timer);
                    res.destroy();
                    reject(new Error(`First raw_token too slow: ${firstTokenMs}ms (threshold ${FIRST_TOKEN_TIMEOUT_MS}ms)`));
                    return;
                  }
                }
              }
            } catch {}
          }
        });

        res.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
        res.on("end", () => finish());
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log("=== Plan-mode manager-chat streaming test ===");

  let projectId: string | null = null;
  let passed = true;

  try {
    console.log("1. Creating blank test project...");
    projectId = await createProject("__streaming_test__");
    console.log(`   Project ID: ${projectId}`);

    console.log("2. Sending message to /api/manager-chat (SSE)...");
    const { firstTokenMs, tokenCount } = await testManagerChatStreaming(projectId);

    console.log(`   First raw_token: ${firstTokenMs}ms`);
    console.log(`   Total raw_tokens received: ${tokenCount}`);

    if (firstTokenMs > FIRST_TOKEN_TIMEOUT_MS) {
      console.error(`FAIL: First token took ${firstTokenMs}ms — exceeds ${FIRST_TOKEN_TIMEOUT_MS}ms threshold`);
      passed = false;
    } else {
      console.log(`PASS: First token within ${FIRST_TOKEN_TIMEOUT_MS}ms threshold`);
    }

    if (tokenCount < 5) {
      console.error(`FAIL: Only ${tokenCount} tokens received — expected at least 5 for progressive streaming`);
      passed = false;
    } else {
      console.log(`PASS: ${tokenCount} tokens received (progressive streaming confirmed)`);
    }
  } catch (err: any) {
    console.error("FAIL:", err?.message || err);
    passed = false;
  } finally {
    if (projectId) {
      await deleteProject(projectId);
      console.log("Cleanup: test project deleted");
    }
  }

  if (!passed) process.exit(1);
  console.log("=== All checks passed ===");
}

run();
