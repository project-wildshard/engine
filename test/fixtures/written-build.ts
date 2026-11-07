import { build } from 'vite';
// oxlint-disable-next-line import/no-nodejs-modules -- Reads the fixture build a test wrote under its own tmp root.
import { readdirSync, statSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths within that fixture build.
import { join, relative, resolve } from 'node:path';
import { writeBootModules } from '../../scripts/app-build/bootModules';

/** A fixture app built the way scripts/build-app.mjs builds the web app (manifest, hidden source maps, one stylesheet),
 *  then its boot module step: the output folder. */
export async function buildWithBootModules(root: string, options: { readonly minify?: boolean; readonly assetsInlineLimit?: number } = {}): Promise<string> {
  const outDir = resolve(root, 'dist'), inlineLimit = options.assetsInlineLimit ?? 4096;
  await build({ root, configFile: false, logLevel: 'silent',
    build: { outDir, emptyOutDir: true, minify: options.minify ?? false, cssCodeSplit: false, manifest: true, sourcemap: 'hidden', assetsInlineLimit: inlineLimit } });
  writeBootModules(outDir, root);
  return outDir;
}

/** The files a fixture build wrote (not its source maps or build metadata), with their byte sizes. */
export function writtenFiles(outDir: string): { readonly fileName: string; readonly bytes: number }[] {
  return readdirSync(outDir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => ({ fileName: relative(outDir, join(entry.parentPath, entry.name)), bytes: statSync(join(entry.parentPath, entry.name)).size }))
    .filter(file => !file.fileName.endsWith('.map') && !file.fileName.startsWith('.vite/'));
}
