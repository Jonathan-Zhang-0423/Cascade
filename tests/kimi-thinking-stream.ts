/**
 * Kimi K2.5 thinking_token streaming validation.
 *
 * This validates that /api/build-session emits thinking_token events
 * when using Kimi as the provider, and that step_starting fires before them.
 */

import http from "http";

const BASE_URL = "http://localhost:5000";
const TIMEOUT_MS = 120_000;

type ParsedJson = Record<string, unknown>;

function postJson(path: string, body: object): Promise<ParsedJson> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data) as ParsedJson); } catch { reject(new Error(`Parse: ${data.slice(0, 200)}`)); } });
    });
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
  events: { type: string; token?: string }[];
  seenDone: boolean;
  totalMs: number;
}

function streamBuildSessionKimi(projectId: string): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const sessionId = `test_kimi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const plan = {
      summary: "Add a greeting to the page",
      steps: [{ step: 1, title: "Add greeting", description: "Add <p>Hello!</p> to the page.", acceptance_criteria: "Page shows Hello!" }],
    };

    const payload = JSON.stringify({
      sessionId,
      plan,
      userRequest: "Add a greeting",
      userLang: "English",
      files: [{ path: "/project/index.html", content: "<!DOCTYPE html><html><body></body></html>" }],
      provider: "kimi",
    });

    const req = http.request(`${BASE_URL}/api/build-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "Accept": "text/event-stream" },
    }, (res) => {
      const startMs = Date.now();
      const events: { type: string; token?: string }[] = [];
      let seenDone = false;
      let buf = "";
      let done = false;

      const guard = setTimeout(() => {
        if (!done) { done = true; res.destroy(); reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)); }
      }, TIMEOUT_MS);

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        res.destroy();
        resolve({ events, seenDone, totalMs: Date.now() - startMs });
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
            const ev = JSON.parse(raw) as Record<string, unknown>;
            const type = ev.type as string;
            if (type) {
              events.push({ type, token: ev.token as string | undefined });
              if (type === "done") { seenDone = true; finish(); }
            }
          } catch {}
        }
      });
      res.on("error", (e) => { if (!done) { done = true; clearTimeout(guard); reject(e); } });
      res.on("end", () => finish());
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function check(label: string, pass: boolean, detail: string): boolean {
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  ${icon}: ${label} — ${detail}`);
  return pass;
}

async function run() {
  console.log("=== Kimi K2.5 thinking_token stream validation ===\n");
  let projectId: string | null = null;
  const results: boolean[] = [];

  try {
    const uid = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = await postJson("/api/projects", { id: uid, name: "__kimi_thinking_test__" });
    const proj = (created.project as { id: string } | undefined);
    if (!proj?.id) throw new Error(`Unexpected: ${JSON.stringify(created)}`);
    projectId = proj.id;
    console.log(`[1] Project: ${projectId}\n`);

    console.log("[2] Streaming /api/build-session with provider=kimi ...");
    const r = await streamBuildSessionKimi(projectId);

    const eventTypes = r.events.map(e => e.type);
    const thinkingTokens = r.events.filter(e => e.type === "thinking_token");
    const narrationTokens = r.events.filter(e => e.type === "narration_token");
    const stepStarting = r.events.filter(e => e.type === "step_starting");

    console.log(`    Total events: ${r.events.length}`);
    console.log(`    step_starting events: ${stepStarting.length}`);
    console.log(`    thinking_token events: ${thinkingTokens.length}`);
    console.log(`    narration_token events: ${narrationTokens.length}`);
    console.log(`    Total duration: ${r.totalMs}ms`);
    console.log(`    done: ${r.seenDone}`);
    
    if (thinkingTokens.length > 0) {
      const firstThinkingIdx = eventTypes.indexOf("thinking_token");
      const firstStepStartingIdx = eventTypes.indexOf("step_starting");
      console.log(`    First step_starting at event index: ${firstStepStartingIdx}`);
      console.log(`    First thinking_token at event index: ${firstThinkingIdx}`);
      console.log(`    First thinking token content (50 chars): "${thinkingTokens[0].token?.slice(0, 50)}"`);
    }

    console.log("\n[3] Assertions:");
    results.push(check("step_starting fires", stepStarting.length >= 1, `${stepStarting.length} events`));
    results.push(check(
      "step_starting comes before thinking_token",
      stepStarting.length >= 1 && (thinkingTokens.length === 0 || eventTypes.indexOf("step_starting") < eventTypes.indexOf("thinking_token")),
      thinkingTokens.length > 0 ? `step_starting @ ${eventTypes.indexOf("step_starting")}, thinking @ ${eventTypes.indexOf("thinking_token")}` : "no thinking tokens to compare"
    ));
    results.push(check("thinking_token events received (Kimi thinking)", thinkingTokens.length > 0, `${thinkingTokens.length} tokens`));
    results.push(check("done event received", r.seenDone, r.seenDone ? "yes" : "no"));
    results.push(check("completed within timeout", r.totalMs < TIMEOUT_MS, `${r.totalMs}ms`));

  } catch (err: any) {
    console.error("\nFAIL (exception):", err?.message ?? String(err));
    results.push(false);
  } finally {
    if (projectId) {
      await deleteReq(`/api/projects/${projectId}`);
      console.log("\nCleanup done.");
    }
  }

  const allPassed = results.every(Boolean);
  console.log(`\n=== ${allPassed ? "All checks passed" : `${results.filter(r => !r).length} FAILED`} ===`);
  if (!allPassed) process.exit(1);
}

run();
