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
      const status = err?.code || err?.response?.status;
      // Retry on rate limit or server errors
      if (status === 429 || (status && status >= 500 && status < 600)) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(
          `${description} failed with status ${status}. Retry ${attempt + 1}/${maxAttempts} in ${delay}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
        continue;
      }
      console.error(`${description} failed with non-retryable error`, err);
      throw err;
    }
  }
  console.error(
    `${description} failed after ${maxAttempts} attempts`,
    lastErr
  );
  throw lastErr;
}
