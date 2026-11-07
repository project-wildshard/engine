// Deletes superseded production deployments on every push. Every deployment is a full ~2.5 GB copy billed at
// $0.10 per GB-month, and Vercel's retention policy trails this release rate by days: a 1-day policy still held 250
// deployments and $2 a day on 2026-11-05. Jake keeps the last five builds; rollback is a deploy forward.
import { pathToFileURL } from 'node:url';

export const KEEP_PROMOTED = 5;
/** A release promotes its stage about 20 minutes after the upload, and a deleted stage only falls back to a fresh deploy. */
export const STAGED_GRACE_MS = 60 * 60 * 1000;

/** @typedef {{uid: string, created: number, state?: string, target?: string|null, readySubstate?: string}} Deployment */

/** Live, aliased, the newest promoted and young stages stay; an unknown substate is never deleted.
 * @param {readonly Deployment[]} deployments @param {{liveId: string, aliased: ReadonlySet<string>, now: number}} context
 * @returns {Deployment[]} */
export function prunable(deployments, { liveId, aliased, now }) {
  const ready = deployments.filter((deployment) => deployment.state === 'READY' && deployment.target === 'production');
  const newest = [...ready].sort((a, b) => b.created - a.created);
  const kept = new Set(newest.filter((deployment) => deployment.readySubstate === 'PROMOTED')
    .slice(0, KEEP_PROMOTED).map((deployment) => deployment.uid));
  return newest.filter((deployment) => deployment.uid !== liveId && !aliased.has(deployment.uid) && !kept.has(deployment.uid)
    && (deployment.readySubstate === 'PROMOTED'
      || (deployment.readySubstate === 'STAGED' && now - deployment.created > STAGED_GRACE_MS)));
}

/** Vercel answered, and the answer will not change on a retry. */
class RefusedError extends Error {
  name = 'RefusedError';
}

/** A timeout, a 429 or a 5xx is retried; a run that gives up names the request, so the warning says what to look at.
 * @template T @param {string} label @param {() => Promise<T>} call
 * @param {(milliseconds: number) => Promise<void>} [pause] @returns {Promise<T>} */
export async function withRetries(label, call, pause = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); })) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof RefusedError || attempt >= 4) throw new Error(`${label}: ${reason} (attempt ${attempt})`, { cause: error });
      console.log(`${label}: ${reason}; retrying`);
      await pause(attempt * 5_000);
    }
  }
}

/** @param {string} name @returns {string} */
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const token = required('VERCEL_BUILD_TOKEN'), team = required('VERCEL_ORG_ID'), project = required('VERCEL_PROJECT_ID');
  /** @param {string} path @param {string} [method] @returns {Promise<any>} */
  const api = (path, method = 'GET') => withRetries(`${method} ${path}`, async () => {
    const response = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${team}`,
      { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    if (response.ok) return response.json();
    if (method === 'DELETE' && response.status === 404) return undefined; // A parallel run's prune got there first.
    const message = `HTTP ${response.status}`;
    throw response.status === 429 || response.status >= 500 ? new Error(message) : new RefusedError(message);
  });
  /** @param {string} path @param {string} key @returns {Promise<any[]>} */
  const pages = async (path, key) => {
    const rows = [];
    for (let until; ;) {
      const page = await api(`${path}${until ? `&until=${until}` : ''}`);
      rows.push(...page[key]);
      until = page.pagination?.next;
      if (!until) return rows;
    }
  };
  const deployments = await pages(`/v6/deployments?projectId=${project}&limit=100`, 'deployments');
  const aliases = await pages(`/v4/aliases?projectId=${project}&limit=100`, 'aliases');
  const liveId = (await api(`/v9/projects/${project}`)).targets?.production?.id;
  if (!deployments.some((deployment) => deployment.uid === liveId)) throw new Error('The live deployment is not in the listing');
  const stale = prunable(deployments, { liveId, aliased: new Set(aliases.map((alias) => alias.deploymentId)), now: Date.now() });
  for (const deployment of stale) await api(`/v13/deployments/${deployment.uid}`, 'DELETE');
  console.log(`Pruned ${stale.length} of ${deployments.length} deployments`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.log(`::warning::Deployment prune failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
