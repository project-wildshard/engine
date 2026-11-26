import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vitest/config';
import type { VitestPluginContext } from 'vitest/node';

/** Every workspace layer's manifest, whose exports map decides what a cached specifier resolved to. */
export function resolutionKey(root: string): string {
  const hash = createHash('sha256'), source = resolve(root, 'src');
  // Root imports, workspace membership and installed public packages also
  // decide the resolved addresses retained inside a transformed caller.
  for(const name of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml']){
    const manifest=resolve(root,name);if(existsSync(manifest))hash.update(`${name}\0`).update(readFileSync(manifest));
  }
  for (const layer of existsSync(source) ? readdirSync(source).sort() : []) {
    const manifest = resolve(source, layer, 'package.json');
    if (existsSync(manifest)) hash.update(`${layer}\0`).update(readFileSync(manifest));
  }
  // J196 local aliases deliberately leave the root lock/manifests unchanged.
  // Cached callers hold resolved addresses and dependency export maps too.
  const packageFile=resolve(root,'package.json');
  const pkg=(existsSync(packageFile)?JSON.parse(readFileSync(packageFile,'utf8')):{}) as {dependencies?:Record<string,string>;devDependencies?:Record<string,string>;optionalDependencies?:Record<string,string>};
  const dependencies=new Set([...Object.keys(pkg.dependencies??{}),...Object.keys(pkg.devDependencies??{}),...Object.keys(pkg.optionalDependencies??{})]);
  for(const name of [...dependencies].sort()){
    const directory=resolve(root,'node_modules',name),manifest=resolve(directory,'package.json');
    hash.update(`dependency:${name}\0`);
    if(existsSync(manifest))hash.update(realpathSync(directory)).update('\0').update(readFileSync(manifest));
    else hash.update('missing');
    hash.update('\0');
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
