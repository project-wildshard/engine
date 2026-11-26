// QA 11-25 row 93: with no generated shard list, the loader learns which shards exist from the built products' discovery
// documents in out/. A product an older pins run left there (Pine's, from before format 0.80 renamed `gridShardfile`)
// no longer parses, and `pnpm pins`, which loads this before it replaces those products, stopped on it: the tree could
// never be mended. A pins install now passes over such a product (it is about to be replaced); every other caller is
// refused with the folder and the one command that mends it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Each built product's shard, in order, from `<products>/<name>/mounts/shardfiles/<name>/discovery.json`.
 * @template S @param {string} products @param {(document: unknown) => S & { order: number }} parse
 * @param {{ replacing?: boolean, warn?: (line: string) => void }} [options] `replacing`: a pins install, which writes them anew */
export function builtShards(products, parse, { replacing = false, warn = (line) => { console.warn(line); } } = {}) {
  if (!existsSync(products)) return [];
  const shards = [];
  for (const name of readdirSync(products).sort()) {
    const file = join(products, name, 'mounts/shardfiles', name, 'discovery.json');
    if (!existsSync(file)) continue;
    try {
      shards.push(parse(JSON.parse(readFileSync(file, 'utf8'))));
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (!replacing) throw new Error(`out/${name} holds a product this engine's format no longer reads (${why}): run pnpm pins`, { cause: error });
      warn(`pins: out/${name} is from an older pin (${why}); it is replaced below`);
    }
  }
  return shards.sort((a, b) => a.order - b.order);
}

/** Whether this process is a pins install (`node src/scripts/pins.ts install`). @param {readonly string[]} argv */
export const pinsInstall = (argv) => /(?:^|[/\\])pins\.ts$/u.test(argv[1] ?? '') && argv[2] === 'install';
