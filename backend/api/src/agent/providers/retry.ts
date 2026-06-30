const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 100;
const RATE_LIMIT_BASE_DELAY_MS = 3000;

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("rate") || msg.includes("速率限制");
}

/**
 * Transient network errors that are safe to retry (the request may not have
 * been processed, or was streaming and got interrupted mid-way).
 */
function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /terminated|ECONNRESET|ETIMEDOUT|socket hang up|network|UND_ERR/i.test(msg);
}

export async function withRetry<T>(
  label: string,
  factory: () => Promise<T>,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await factory();
      if (attempt > 1) {
        console.warn(`[retry] ${label} — succeeded on attempt ${attempt}/${maxAttempts}.`);
      }
      return result;
    } catch (err: unknown) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);

      if (attempt < maxAttempts) {
        const isRateLimit = isRateLimitError(err);
        const isTransient = isTransientError(err);
        if (isRateLimit || isTransient) {
          const baseDelay = isRateLimit ? RATE_LIMIT_BASE_DELAY_MS : BASE_DELAY_MS;
          const delayMs = baseDelay * Math.pow(2, attempt - 1);
          console.warn(
            `[retry] ${label} — attempt ${attempt}/${maxAttempts} failed: ${errMsg}. ${isRateLimit ? "Rate limited — " : isTransient ? "Transient — " : ""}Retrying in ${delayMs}ms…`,
          );
          await new Promise<void>(resolve => setTimeout(resolve, delayMs));
        } else {
          // Non-retryable error — throw immediately
          throw err;
        }
      } else {
        console.warn(
          `[retry] ${label} — attempt ${attempt}/${maxAttempts} failed: ${errMsg}. All attempts exhausted.`,
        );
      }
    }
  }

  throw lastError;
}
