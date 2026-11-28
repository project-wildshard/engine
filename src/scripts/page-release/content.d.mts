/** Fix preview PV15: content sets are read-only history; nothing publishes one (test/page-content.test.ts). */
export const BUCKET: string;
export const CONTENT_ROOT: string;
export const CONTENT_KEYS: readonly ['R2_ACCOUNT_ID', 'R2_PACKS_ACCESS_KEY_ID', 'R2_PACKS_SECRET_ACCESS_KEY'];
export const KEYS_FILE: string;
export function contentKeys(env: NodeJS.ProcessEnv, file?: string): { env: NodeJS.ProcessEnv; missing: string[] };
export function missingKeysMessage(missing: readonly string[]): string;
