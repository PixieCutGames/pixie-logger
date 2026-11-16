import { hashApiKey, isWellFormedApiKey } from './api-key';

const FIND_APP_FOR_KEY_SQL = `SELECT k.app_id AS app_id
FROM api_keys k
JOIN apps a ON a.id = k.app_id
WHERE k.key_hash = ?1
  AND k.revoked_at IS NULL
  AND a.disabled_at IS NULL
LIMIT 1`;

/**
 * Returns the app id for a valid, active key, or null.
 * Null for: missing/malformed key, unknown hash, revoked key, disabled app.
 */
export async function findAppIdForKey(db: D1Database, key: string | undefined): Promise<string | null> {
	const trimmed = key?.trim();
	if (!trimmed || !isWellFormedApiKey(trimmed)) {
		return null;
	}
	const keyHash = await hashApiKey(trimmed);
	const row = await db.prepare(FIND_APP_FOR_KEY_SQL).bind(keyHash).first<{ app_id: string }>();
	return row?.app_id ?? null;
}
