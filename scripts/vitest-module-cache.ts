import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vitest/config';
import type { VitestPluginContext } from 'vitest/node';

/** Every workspace layer's manifest, whose exports map decides what a cached specifier resolved to. */
export function resolutionKey(root: string): string {
  const hash = createHash('sha256'), source = resolve(root, 'src');
  for (const layer of existsSync(source) ? readdirSync(source).sort() : []) {
    const manifest = resolve(source, layer, 'package.json');
    if (existsSync(manifest)) hash.update(`${layer}\0`).update(readFileSync(manifest));
  }
  return hash.digest('hex');
}

/** Glob transforms depend on directory membership as well as the importing source. Every transform also holds its
 * imports resolved: the cache survives between CI runs, so a file a retag moves must not stay at its old address in
 * transforms whose own bytes did not change. */
export function vitestModuleCache(): Plugin {
  return {
    name: 'wildshard:vitest-module-cache',
    configureVitest({ defineCacheKeyGenerator }: VitestPluginContext) {
      // Vitest 5.0.1 only excludes the literal `import.meta.glob(` spelling.
      // Type arguments and whitespace bypass it; old expansions then keep deleted
      // files and miss new ones. Decline those entries before reading any cache.
      const resolution = resolutionKey(process.cwd());
      defineCacheKeyGenerator(({ sourceCode }) =>
        /import\s*\.\s*meta\s*\.\s*glob\b/u.test(sourceCode) ? false : resolution);
    },
  };
}
