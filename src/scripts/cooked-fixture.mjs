// Fix preview PV6: a `file:` folder laid out like the cooked bucket, from the installed pins' `out/<slug>/` folders, so a bake that
// reads the cook (`cooked-reads.mjs`) can be compared byte for byte with today's pinned bake. Each file of `out/<slug>/` is linked at
// `shards/<slug>/<shardVersion>/common/<path>`, and the zone's index maps `shardfiles/<slug>/<path>` to it.
// CLI: node --import ./src/scripts/bake-loader.mjs src/scripts/cooked-fixture.mjs <dir> [slug...]   (prints the zone table's path)
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {cookedIndexKey} from '../shared/game/shardfile/cookedPackPaths.ts';

const SEGMENT = /^[\w-][\w.-]*$/u;
/** @param {string} dir @returns {string[]} */
const files = dir => readdirSync(dir, {withFileTypes: true, recursive: true}).filter(entry => entry.isFile())
  .map(entry => relative(dir, join(entry.parentPath, entry.name))).sort();

/**
 * Lays out `slugs` (default: every folder of `out/` with a `shard.json`) under `dir` and returns the zone table for it.
 * A path the key module refuses (`cookedPackPaths.ts` segments) is left out, as the cook would not write it.
 * @param {string} root @param {string} dir @param {{slugs?: string[], shardVersion?: string, cookVersion?: string}} [options]
 */
export function cookedFixture(root, dir, {slugs, shardVersion = '0.0.1', cookVersion = '1.0.0'} = {}) {
  const out = resolve(root, 'out'), cookHash = createHash('sha256').update('pv6-fixture').digest('hex');
  const chosen = slugs ?? readdirSync(out).filter(slug => existsSync(join(out, slug, 'shard.json'))).sort();
  const zones = [];
  for (const slug of chosen) {
    const ref = {slug, shardVersion, cookVersion, cookHash}, common = `shards/${slug}/${shardVersion}/common/`;
    /** @type {Record<string, string>} */ const objects = {};
    for (const path of files(join(out, slug))) {
      if (!path.split('/').every(part => SEGMENT.test(part))) continue;
      const target = join(dir, common, path);
      mkdirSync(resolve(target, '..'), {recursive: true});
      if (!existsSync(target)) symlinkSync(join(out, slug, path), target);
      objects[`shardfiles/${slug}/${path}`] = `${common}${path}`;
    }
    const index = cookedIndexKey(ref);
    mkdirSync(resolve(dir, index, '..'), {recursive: true});
    writeFileSync(join(dir, index), JSON.stringify({version: 2, ...ref, hash: cookHash, header: `shardfiles/${slug}/shard.json`, manifests: [], objects}));
    zones.push({slug, shardVersion, index});
  }
  const table = {version: 1, from: {channel: 'staging', serial: 1, engineBuild: '0'.repeat(40)}, cookVersion, cookHash, zones};
  writeFileSync(join(dir, 'zone-table.json'), JSON.stringify(table));
  return {table, origin: pathToFileURL(`${resolve(dir)}/`).href};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, ...slugs] = process.argv.slice(2);
  if (dir === undefined) throw new Error('usage: cooked-fixture.mjs <dir> [slug...]');
  const {origin} = cookedFixture(process.cwd(), dir, slugs.length === 0 ? {} : {slugs});
  process.stdout.write(`${join(resolve(dir), 'zone-table.json')} ${origin}\n`);
}
