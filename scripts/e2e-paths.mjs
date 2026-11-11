// The Template 2 smoke's scratch layout (TEMPLATE-E2E-PLAN, TB-1). Everything it writes lives under this
// worktree's tmp/e2e, never /tmp (AGENTS.md "Disk").
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const E2E_DIR = 'tmp/e2e';
/** The smoke's one-shard catalogue: Template 2, from the format dependency, in every grid cell. */
export const CATALOGUE = `${E2E_DIR}/catalogue.json`;
/** The warm watcher's build output, served by its preview server. */
export const CLIENT_DIR = `${E2E_DIR}/client`;
/** The live watcher: pid, control port and token, preview origin. Removed when it exits. */
export const STATE_FILE = `${E2E_DIR}/watcher.json`;
export const WATCH_LOG = `${E2E_DIR}/watcher.log`;
/** The last smoke run's split, the pre-push receipt (TB-4). */
export const RECEIPT = `${E2E_DIR}/receipt.json`;
export const BUILD_ID = 'e2e-smoke';
export const TEMPLATE = 'out/blender-template';

/** What the watcher prepared once: when this moves, its build no longer matches and it must restart.
 * @param {string} root */
export function preparedKey(root) {
  const hash = createHash('sha256');
  for (const file of [CATALOGUE, `${TEMPLATE}/validation.json`]) {
    const path = join(root, file);
    hash.update(file).update(existsSync(path) ? readFileSync(path) : 'missing');
  }
  return hash.digest('hex');
}
