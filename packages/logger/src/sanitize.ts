export const DEFAULT_REDACT_SUBSTRINGS: readonly string[] = [
  'password',
  'passwd',
  'token',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'sessionid',
  'email',
  'phone',
  'creditcard',
  'cardnumber',
  'nationalid',
];
export const DEFAULT_REDACT_SUFFIXES: readonly string[] = ['otp', 'cvv', 'iban', 'pin'];
export const REDACTED = '[REDACTED]';

const CIRCULAR = '[Circular]';
const TRUNCATED = '[Truncated]';
const MAX_DEPTH = 5;

/** Lowercase, with '-' and '_' removed. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

export function makeKeyRedactor(extraKeys: readonly string[]): (key: string) => boolean {
  const exact = new Set<string>();
  for (const k of extraKeys) {
    if (typeof k === 'string') {
      const n = normalizeKey(k);
      if (n) exact.add(n);
    }
  }
  return (key: string): boolean => {
    const n = normalizeKey(key);
    if (exact.has(n)) return true;
    for (const s of DEFAULT_REDACT_SUBSTRINGS) if (n.includes(s)) return true;
    for (const s of DEFAULT_REDACT_SUFFIXES) if (n.endsWith(s)) return true;
    return false;
  };
}

/** Marker for values that are omitted from objects (and become null in arrays). */
const OMIT = Symbol('omit');

function sanitizeValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  shouldRedact: (key: string) => boolean,
): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return OMIT;
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return null;

  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : value.toISOString();
  }
  if (value instanceof Error) {
    return { name: String(value.name), message: String(value.message) };
  }
  if (ancestors.has(value)) return CIRCULAR;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const v = sanitizeValue(item, depth + 1, ancestors, shouldRedact);
        return v === OMIT ? null : v;
      });
    }
    return sanitizeObject(value as Record<string, unknown>, depth + 1, ancestors, shouldRedact);
  } finally {
    ancestors.delete(value);
  }
}

/** Sanitises an object's own keys, which sit at `depth`. */
function sanitizeObject(
  obj: Record<string, unknown>,
  depth: number,
  ancestors: Set<object>,
  shouldRedact: (key: string) => boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // defineProperty, not assignment: `out['__proto__'] = v` would set the prototype and lose the key.
  const set = (key: string, v: unknown): void => {
    Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
  };
  for (const key of Object.keys(obj)) {
    if (shouldRedact(key)) {
      set(key, REDACTED);
      continue;
    }
    const v = sanitizeValue(obj[key], depth, ancestors, shouldRedact);
    if (v !== OMIT) set(key, v);
  }
  return out;
}

/**
 * Returns a JSON-safe copy of `value` with sensitive keys redacted.
 * The record's own keys are at depth 1; values deeper than 5 become '[Truncated]'.
 */
export function sanitizeRecord(
  value: Record<string, unknown>,
  shouldRedact: (key: string) => boolean,
): Record<string, unknown> {
  const ancestors = new Set<object>([value]);
  return sanitizeObject(value, 1, ancestors, shouldRedact);
}
