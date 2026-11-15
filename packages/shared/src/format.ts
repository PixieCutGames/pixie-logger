import type { z } from 'zod';

/** Turns zod issues into short strings like "event: Too small…" or "(root): event exceeds 8192 bytes". */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}
