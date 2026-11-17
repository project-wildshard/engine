/** @typedef {{instance: string, slug: string, hash: string}} Head */
/** @typedef {{serial: number, cells: readonly {instance: string, slug: string, hash?: string}[]}} Snapshot */

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
