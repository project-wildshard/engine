// The discovery module's static dependency graph comes from authored bindings,
// not product values. Program-only art names its existing authored JSON source;
// the real discovery emitter checks this projection against its actual imports.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';

const ArtInputs = v.record(v.string(), v.array(v.strictObject({
  file: v.pipe(v.string(), v.regex(/^(?:data|boot)\/[a-zA-Z0-9_-]+\.json$/u)),
  field: v.pipe(v.array(v.pipe(v.string(), v.regex(/^[a-zA-Z][a-zA-Z0-9]*$/u))), v.minLength(1)),
})));

/** @param {string} root @param {string} folder @param {Record<string,unknown>} data @param {boolean} [composed] */
export function authoredManifestImports(root, folder, data, composed = false) {
  if (!/^[a-z0-9_-]+$/u.test(folder)) throw new Error('Invalid manifest import owner');
  const bindings = data.bindings;
  if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings)) throw new Error('Missing manifest bindings');
  /** @type {string[]} */
  const imports = ['../../game/client/shard/manifest', ...(composed ? [] : ['./manifest.json'])];
  /** @param {unknown} value @returns {Record<string,unknown>} */
  const record = value => typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
  const b = record(bindings);
  /** @param {unknown} ref */
  const value = ref => {
    const row = record(ref);
    if (row.program === true) {
      if (Object.keys(row).length !== 1) throw new Error('Invalid program import binding');
      return;
    }
    if (typeof row.module !== 'string' || !/^\.\/[a-zA-Z0-9_./-]+$/u.test(row.module) || row.module.split('/').includes('..')) throw new Error('Invalid static manifest binding');
    imports.push(row.module);
  };
  /** @param {unknown} item */
  const images = item => {
    if (typeof item === 'string' && item.startsWith('/src/')) {
      if (!item.startsWith(`/src/shards/${folder}/`) || !/^\/src\/shards\/[a-z0-9_-]+\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|svg|hdr)$/u.test(item) || item.split('/').includes('..')) throw new Error('Invalid manifest source image');
      imports.push(`./${item.slice(`/src/shards/${folder}/`.length)}`);
    } else if (Array.isArray(item)) item.forEach(images);
    else if (typeof item === 'object' && item !== null) Object.values(item).forEach(images);
  };
  for (const key of ['card', 'sky', 'minimap', 'explore', 'horizonStrips']) images(data[key]);
  const boot = record(b.boot), explore = record(boot.explore);
  if (explore.program === true) {
    const sources = v.parse(ArtInputs, JSON.parse(readFileSync(resolve(root, 'scripts/manifest-art-inputs.json'), 'utf8')));
    const rows = sources[folder];
    if (!Array.isArray(rows)) throw new Error('Program Explorer art requires declared source inputs');
    for (const row of rows) {
      /** @type {unknown} */
      let input = JSON.parse(readFileSync(resolve(root, 'src/shards', folder, row.file), 'utf8'));
      for (const key of row.field) input = record(input)[key];
      if (!Array.isArray(input) || input.some(item => typeof item !== 'string')) throw new Error('Program art input requires image strings');
      images(input);
    }
  } else if (typeof explore.module === 'string') {
    value(explore);
    const input = JSON.parse(readFileSync(resolve(root, 'src/shards', folder, explore.module), 'utf8'));
    images(input.art);
  }
  const budgets = record(b.budgets);
  if (budgets.program !== true && typeof budgets.module === 'string' && !budgets.module.endsWith('.json') && !budgets.module.startsWith('./data/')) value(budgets);
  for (const key of ['runtimeCost', 'mapPalette', 'poses', 'forestQueries', 'pondClip', 'groundRows', 'groundColourSamples', 'surfaceSamples', 'forestMaskSamples', 'mapGroundSamples', 'navmesh']) {
    if (b[key] === undefined) continue;
    const ref = record(b[key]);
    if (key === 'forestQueries' && ref.platform === 'fixed') continue;
    if (ref.platform === 'declared') value(ref.rows);
    else if (key !== 'mapPalette' || typeof ref.module !== 'string' || !ref.module.endsWith('.json')) value(ref);
  }
  const spawns = record(b.spawns);
  if (b.spawns !== undefined && !(typeof spawns.module === 'string' && spawns.module.startsWith('./generators/'))) value(spawns);
  if (b.navigation !== undefined) value(b.navigation);
  if (b.audioCues !== undefined) value(b.audioCues);
  const sword = record(b.sword);
  if (sword.rows !== undefined) value({ module: sword.rows });
  if (boot.platform === 'page-mode') { imports.push('@wildshard/engine/game/shard/pageBoot'); value(boot.rows); }
  else for (const key of ['files', 'sources', 'lateReads', 'bakedUnread', 'explore']) if (boot[key] !== undefined) value(boot[key]);
  const ground = record(b.ground);
  if (b.ground !== undefined) value(ground.platform === 'declared' ? ground.rows : ground);
  const render = record(b.render);
  if (render.platform === 'keyed') { value(render.looks); value(render.trim); }
  const roster = record(b.roster);
  if (roster.platform === 'held') value({ module: roster.rows });
  return [...new Set(imports)].sort((left, right) => left.localeCompare(right));
}
