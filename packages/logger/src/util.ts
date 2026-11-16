/** Plain object check: not null, not an array. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** s.slice(0, max), but if the result ends with a high surrogate (0xD800–0xDBFF), drop that last code unit. */
export function truncate(s: string, max: number): string {
  const out = s.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}
