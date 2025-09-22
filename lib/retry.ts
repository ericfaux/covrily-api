// lib/retry.ts
// Assumes HTTP/Gmail clients surface transient failures via status codes or Node.js error codes;
// trade-off is relying on generic heuristics instead of client-specific logic, which keeps retry
// behavior consistent across callers while still covering common flaky network scenarios.

const RETRIABLE_SYSTEM_CODES = new Set([
  "EBUSY",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNABORTED",
  "EPIPE",
  "EPROTO",
  "ECONNREFUSED",
]);

function resolveStatus(err: any): number | null {
  const statusLike = err?.response?.status ?? err?.status ?? err?.statusCode;
  if (typeof statusLike === "number") return statusLike;
  const parsed = Number.parseInt(statusLike, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveSystemCode(err: any): string | null {
  const code = err?.code ?? err?.cause?.code ?? err?.error?.code;
  return typeof code === "string" ? code : null;
}

function getRetryReason(err: any): string | null {
  const status = resolveStatus(err);
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500 && status < 600) {
    return `http_${status}`;
  }

  const code = resolveSystemCode(err);
  if (code && RETRIABLE_SYSTEM_CODES.has(code)) {
    return `sys_${code}`;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  description: string,
  maxAttempts = 5
): Promise<T> {
  let attempt = 0;
  let lastErr: any;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const reason = getRetryReason(err);
      const hasMoreAttempts = attempt < maxAttempts - 1;
      if (reason && hasMoreAttempts) {
        const baseDelay = Math.min(1000 * 2 ** attempt, 10_000);
        const jitter = Math.random() * 250;
        const delay = baseDelay + jitter;
        console.warn("[retry] transient failure", {
          description,
          attempt: attempt + 1,
          maxAttempts,
          reason,
          delay_ms: Math.round(delay),
        });
        await sleep(delay);
        attempt += 1;
        continue;
      }

      console.error("[retry] non-retryable failure", {
        description,
        attempt: attempt + 1,
        maxAttempts,
        reason,
        error: err,
      });
      throw err;
    }
  }

  console.error("[retry] exhausted attempts", {
    description,
    attempts: maxAttempts,
    error: lastErr,
  });
  throw lastErr;
}
