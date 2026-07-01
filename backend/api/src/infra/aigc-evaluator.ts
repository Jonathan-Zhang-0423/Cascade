// AIGC result evaluator — vision LLM scoring + per-user daily quota + session retry cap.
// Score 0-100; below RETRY_THRESHOLD triggers one automatic retry.

import { getFastClient } from "../agent/providers/kimi-client";

export interface EvalResult {
  score: number;          // 0-100
  issues: string[];       // human-readable issues found
  shouldRetry: boolean;   // true when score < RETRY_THRESHOLD and retries remain
}

const RETRY_THRESHOLD = 55;  // below this score → auto retry
const MAX_SESSION_RETRIES = 1;
const DAILY_QUOTA = 20;

// ── In-memory rate limiters (reset on server restart — acceptable for test env) ──

// sessionId → retry count for this generation session
const sessionRetries = new Map<string, number>();

// userId → { count, date } for daily quota
const dailyUsage = new Map<string, { count: number; date: string }>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function checkDailyQuota(userId: string): { allowed: boolean; remaining: number } {
  const today = todayStr();
  const rec = dailyUsage.get(userId);
  if (!rec || rec.date !== today) {
    dailyUsage.set(userId, { count: 0, date: today });
    return { allowed: true, remaining: DAILY_QUOTA };
  }
  const remaining = DAILY_QUOTA - rec.count;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}

export function incrementDailyUsage(userId: string): void {
  const today = todayStr();
  const rec = dailyUsage.get(userId);
  if (!rec || rec.date !== today) {
    dailyUsage.set(userId, { count: 1, date: today });
  } else {
    rec.count += 1;
  }
}

export function canRetry(sessionId: string): boolean {
  return (sessionRetries.get(sessionId) ?? 0) < MAX_SESSION_RETRIES;
}

export function incrementSessionRetry(sessionId: string): void {
  sessionRetries.set(sessionId, (sessionRetries.get(sessionId) ?? 0) + 1);
}

export function clearSessionRetries(sessionId: string): void {
  sessionRetries.delete(sessionId);
}

// ── Vision LLM scoring ────────────────────────────────────────────────────────

export async function evaluatePoster(
  imageB64: string,
  prompt: string,
  sessionId: string,
): Promise<EvalResult> {
  try {
    const { client, model } = getFastClient();

    const completion = await (client.chat.completions.create as Function)({
      model,
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageB64}` },
            },
            {
              type: "text",
              text: `请对这张 App 宣传海报进行质量评分。用户的生成需求是："${prompt}"。

评分维度（各25分，满分100）：
1. 相关性：图像是否体现了用户需求的意图
2. 视觉质量：构图、色彩、清晰度是否专业
3. App可识别度：能否看出这是一个 App 的宣传图
4. 整体美观度：是否具有视觉吸引力

请只返回 JSON，格式：
{"score":75,"issues":["问题1","问题2"]}

issues 为空数组表示无问题，有问题时用简短中文描述（每条10字以内）。`,
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in response");
    const parsed = JSON.parse(match[0]) as { score?: number; issues?: string[] };
    const score = Math.min(100, Math.max(0, Number(parsed.score ?? 50)));
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const shouldRetry = score < RETRY_THRESHOLD && canRetry(sessionId);
    return { score, issues, shouldRetry };
  } catch (err) {
    console.warn("[aigc-evaluator] scoring failed:", err instanceof Error ? err.message : err);
    // On evaluator failure: don't block the user, return passing score
    return { score: 70, issues: [], shouldRetry: false };
  }
}
