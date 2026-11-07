/** Display names of the seven SF67 benchmark cards; shared by desktop and Safari drivers. */
const names = new Map([
  ['driftwood-isle', 'Driftwood Isle'], ['nalati-grasslands', 'Nalati'], ['pine-hollow', 'Pine Hollow'],
  ['_template', 'Template shard'], ['blender-template', 'Blender Template'], ['far-reach', 'Sky Reach'], ['sunscar-dunes', 'Signal Dunes'],
  ['nine-dragon-stack', 'Nine Dragon'],
]);

/** Refuse unsupported rows before opening a browser or measuring another shard's card.
 * @param {string} shard */
export function loadingShardName(shard) {
  const name = names.get(shard);
  if (name === undefined) throw new Error(`Unknown benchmark shard: ${shard}`);
  return name;
}

/** Developer-only cards must be visible before their real entry control can be measured.
 * @param {string} shard */
export function loadingShardNeedsDeveloper(shard) {
  loadingShardName(shard);
  return ['_template', 'far-reach', 'sunscar-dunes', 'nine-dragon-stack'].includes(shard);
}

/** Each requested cold/warm row owns one file; duplicates cannot overwrite its evidence.
 * @param {string} value */
export function loadingShards(value) {
  const shards = value.split(',');
  if (new Set(shards).size !== shards.length) throw new Error('Duplicate benchmark shard');
  for (const shard of shards) loadingShardName(shard);
  return shards;
}

/** A missing or ambiguous visible card fails the run instead of silently dropping a requested row.
 * @param {readonly string[]} titles
 * @param {string} shard */
export function loadingCardIndex(titles, shard) {
  const name = loadingShardName(shard).toLowerCase();
  const matches = titles.flatMap((title, index) => title.toLowerCase().includes(name) ? [index] : []);
  const index = matches.at(0);
  if (matches.length !== 1 || index === undefined) throw new Error(`Selected shard card absent or ambiguous: ${shard} (${titles.join(', ')})`);
  return index;
}
