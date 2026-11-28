// PAGE-SIZE PZ2 to PZ6 published a page's shard content and engine art to the packs bucket as content sets,
// `content/<set>/<page path>`, read through packs.wildshard.io. Fix preview PV17 (engine 7c16fdaa5) stopped every
// channel publishing one, and PV15 removed the publish path: what is left here names the sets and the packs bucket's
// S3 keys, for src/scripts/content-prune.mjs, which deletes the old sets once nothing reads them.
// test/page-content.test.ts fails if this file, or any release path, publishes a content set again.
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';

export const BUCKET = 'wildshard-packs';
export const CONTENT_ROOT = 'content';
/** Meta Cloudflare audit CF2: the packs bucket's R2 S3 keys (server-release's bucket-scoped keys). */
export const CONTENT_KEYS = /** @type {const} */ (['R2_ACCOUNT_ID', 'R2_PACKS_ACCESS_KEY_ID', 'R2_PACKS_SECRET_ACCESS_KEY']);
/** The MacBook's copy of the box's cook.env, which holds the packs bucket's S3 keys (release-train.ts loads it too). */
export const KEYS_FILE = join(homedir(), '.config/wildshard/cook.env');

/**
 * CF2: the environment with each content key filled from `file` where it is unset or blank, and the names still missing.
 * Only the three names are read from the file; their values stay in the returned environment, never in a message.
 * @param {NodeJS.ProcessEnv} env @param {string} [file]
 * @returns {{env: NodeJS.ProcessEnv, missing: string[]}}
 */
export function contentKeys(env, file = KEYS_FILE) {
  /** @type {NodeJS.ProcessEnv} */ const filled = {...env};
  const blank = (/** @type {string} */ name) => (filled[name] ?? '').trim() === '';
  if (CONTENT_KEYS.some(blank) && existsSync(file)) {
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const name of CONTENT_KEYS) if (blank(name) && (parsed[name] ?? '').trim() !== '') filled[name] = parsed[name];
  }
  return {env: filled, missing: CONTENT_KEYS.filter(blank)};
}

/** The refusal without the keys: names, never values. @param {readonly string[]} missing */
export const missingKeysMessage = missing =>
  `the packs bucket's S3 keys are missing (${missing.join(', ')}): export them or put them in ${KEYS_FILE}`;
