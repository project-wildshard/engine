/** @typedef {{instance: string, slug: string, hash: string}} Head */
/** @typedef {{serial: number, cells: readonly {instance: string, slug: string, hash?: string}[]}} Snapshot */

/** SHARD-COMPAT NB4 (meta NEVER-BREAK-LIVE I4): what a placed head's exact-build cook index must hold before the alias
 *  moves: this build, this head, a passing check, and an entry manifest for both tiers, so a phone and a desktop page each
 *  boot it cold. Returns the reason it is not ready, or null.
 * @param {unknown} index @param {{build: string, slug: string, hash: string}} want @returns {string | null} */
export function placedIndexProblem(index, want) {
  const row = /** @type {{build?: unknown, hash?: unknown, slug?: unknown, check?: {pass?: unknown}, manifests?: unknown} | null} */ (index);
  if (row === null || typeof row !== 'object') return 'no index';
  if (row.build !== want.build || row.hash !== want.hash || row.slug !== want.slug) return 'another build or head';
  if (row.check?.pass !== true) return 'its check did not pass';
  const manifests = Array.isArray(row.manifests) ? /** @type {{tier?: unknown, set?: unknown}[]} */ (row.manifests) : [];
  const missing = ['phone', 'desktop'].filter(tier => !manifests.some(entry => entry.tier === tier && entry.set === 'entry'));
  return missing.length === 0 ? null : `no ${missing.join(' or ')} entry manifest`;
}

/** Ready the signed extra cells a page will discover, then refuse a changed snapshot.
 * Built-in cells already have the release's verified server book and client packs.
 * @param {{base: readonly {instance: string, slug: string}[], read: () => Promise<Snapshot>, ready: (head: Head) => Promise<boolean>, cook: (head: Head) => Promise<void>}} ports
 */
export async function ensurePlacedHeads(ports) {
  const built = new Map(ports.base.map(cell => [cell.instance, cell.slug]));
  /** @param {Snapshot} file @returns {Head[]} */
  const extras = file => file.cells.flatMap(cell => {
    if (built.get(cell.instance) === cell.slug || cell.hash === undefined) return [];
    if (!/^[a-f0-9]{64}$/u.test(cell.hash)) throw new Error('A placed head has an invalid hash');
    return [{instance: cell.instance, slug: cell.slug, hash: cell.hash}];
  }).sort((a, b) => a.instance.localeCompare(b.instance));
  const before = extras(await ports.read());
  let cooked = 0;
  for (const head of before) {
    if (await ports.ready(head)) continue;
    await ports.cook(head);
    if (!await ports.ready(head)) throw new Error(`Placed ${head.slug} still has no exact-build cook index`);
    cooked++;
  }
  const after = await ports.read();
  if (JSON.stringify(before) !== JSON.stringify(extras(after))) throw new Error('Placed heads changed during readiness; retry this phase before aliasing');
  return {serial: after.serial, heads: before, cooked};
}
