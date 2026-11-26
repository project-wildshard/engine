/** SF64: deterministic infographic bricks. Storage inventories are never added to native WC. */
export const MEMORY_BLOCK_BYTES = 50_000_000;

/**
 * Split each named allocation subtotal without rounding its bytes or merging different owners.
 * @param {readonly {owner:string, domain:'ram'|'gpu', bytes:number}[]} owners
 * @returns {{owner:string,domain:'ram'|'gpu',bytes:number,part:number}[]}
 */
export function memoryBlocks(owners) {
  const blocks = [];
  for (const row of owners) {
    if (!row.owner || !['ram', 'gpu'].includes(row.domain) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 128_000_000_000) throw new RangeError('Invalid memory owner subtotal');
    if (blocks.length + Math.ceil(row.bytes / MEMORY_BLOCK_BYTES) > 10_000) throw new RangeError('Memory infographic exceeds bounded block count');
    for (let remaining = row.bytes, part = 0; remaining > 0; part++) {
      const bytes = Math.min(remaining, MEMORY_BLOCK_BYTES);
      blocks.push({ owner: row.owner, domain: row.domain, bytes, part });
      remaining -= bytes;
    }
  }
  if (blocks.length > 10_000) throw new RangeError('Memory infographic exceeds bounded block count');
  return blocks;
}

/**
 * Deduplicate resource identities before owner grouping. A repeated resource must agree exactly;
 * conflicting owners/bytes are an attribution error, never silently selected or double charged.
 * @param {readonly {id:string,domain:'ram'|'gpu',bytes:number,owner:string,asset:string,kind:string,precision:'exact'|'estimate'}[]} allocations
 */
export function memoryOwnerInventory(allocations) {
  /** @type {Map<string, (typeof allocations)[number]>} */
  const identities = new Map();
  /** @type {Map<string, {owner:string,domain:'ram'|'gpu',bytes:number,exactBytes:number,estimatedBytes:number,allocations:number}>} */
  const owners = new Map();
  /** @type {readonly ('domain'|'bytes'|'owner'|'asset'|'kind'|'precision')[]} */
  const fields = ['domain', 'bytes', 'owner', 'asset', 'kind', 'precision'];
  for (const allocation of allocations) {
    if (!allocation.id || !allocation.owner || !allocation.asset || !allocation.kind || !['ram', 'gpu'].includes(allocation.domain)
      || !['exact', 'estimate'].includes(allocation.precision) || !Number.isSafeInteger(allocation.bytes) || allocation.bytes < 0) throw new RangeError('Invalid memory allocation');
    const previous = identities.get(allocation.id);
    if (previous) {
      if (fields.some(key => previous[key] !== allocation[key])) throw new Error(`Conflicting memory allocation identity: ${allocation.id}`);
      continue;
    }
    identities.set(allocation.id, allocation);
    const key = JSON.stringify([allocation.domain, allocation.owner]);
    const row = owners.get(key) ?? { owner: allocation.owner, domain: allocation.domain, bytes: 0, exactBytes: 0, estimatedBytes: 0, allocations: 0 };
    row.bytes += allocation.bytes;
    if (allocation.precision === 'exact') row.exactBytes += allocation.bytes;
    else row.estimatedBytes += allocation.bytes;
    row.allocations++;
    if (!Number.isSafeInteger(row.bytes)) throw new RangeError('Memory owner subtotal overflows');
    owners.set(key, row);
  }
  return [...owners.values()].sort((a, b) => {
    const domain = a.domain.localeCompare(b.domain);
    if (domain !== 0) return domain;
    if (a.bytes !== b.bytes) return b.bytes - a.bytes;
    return a.owner.localeCompare(b.owner);
  });
}
