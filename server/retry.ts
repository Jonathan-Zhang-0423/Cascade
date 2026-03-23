const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 100;

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
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[retry] ${label} — attempt ${attempt}/${maxAttempts} failed: ${errMsg}. Retrying in ${delayMs}ms…`,
        );
        await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      } else {
        console.warn(
          `[retry] ${label} — attempt ${attempt}/${maxAttempts} failed: ${errMsg}. All attempts exhausted.`,
        );
      }
    }
  }

  throw lastError;
}
