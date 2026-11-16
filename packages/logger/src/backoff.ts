export interface Backoff {
  next(): number;
  reset(): void;
  readonly attempts: number;
}

export function createBackoff(opts?: {
  baseMs?: number;
  maxMs?: number;
  jitter?: number;
  random?: () => number;
}): Backoff {
  const baseMs = opts?.baseMs ?? 5_000;
  const maxMs = opts?.maxMs ?? 300_000;
  const jitter = opts?.jitter ?? 0.2;
  const random = opts?.random ?? Math.random;
  let attempts = 0;

  return {
    next() {
      const raw = Math.min(maxMs, baseMs * 2 ** attempts);
      const delay = Math.round(raw * (1 + (random() * 2 - 1) * jitter));
      attempts++;
      return delay;
    },
    reset() {
      attempts = 0;
    },
    get attempts() {
      return attempts;
    },
  };
}
