import { LOG_LEVELS } from './constants';
import type { LogLevel } from './types';

/** True if `level` is the same as or more severe than `min`. */
export function levelAtLeast(level: LogLevel, min: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(min);
}
