/** E5.4's pointer half (J129): the standalone shell and its server worker beside the client, under the build's folder. The
 * page client loads them by URL at runtime, so they get their own bundle and leave its chunks and budgets alone.
 * standalone-smoke plays this output. Runs before the service worker, which precaches it. */
import { resolve } from 'node:path';
import { build } from 'vite';
import { rapierAlias } from '../../vite/rapier.ts';
import { BUILD_ID_EXPRESSION, codeDirectory } from './buildIdentity.mjs';

/** Where a build's emitted shell is served from.
 * @param {string} buildId */
export const standaloneDirectory = (buildId) => `${codeDirectory(buildId)}/standalone`;

/** @param {string} outDir @param {string} buildId @param {string} root */
export async function writeStandaloneOutput(outDir, buildId, root) {
  const directory = standaloneDirectory(buildId);
  await build({
    configFile: false, root, logLevel: 'warn', publicDir: false, resolve: { alias: rapierAlias }, assetsInclude: ['**/*.bin', '**/*.wasm'],
    define: { __TITLE_ASSET_URLS__: '{}', __BUILD_ID__: BUILD_ID_EXPRESSION }, worker: { format: 'es' },
    build: {
      outDir: resolve(outDir), emptyOutDir: false, assetsDir: directory, target: 'es2022', sourcemap: false, reportCompressedSize: false,
      rolldownOptions: {
        // identity and storage: what a page entry installs, in the shell's own module graph, for a page that isn't this bundle
        input: { shell: resolve(root, 'src/client/host/standalone/shell.ts'), online: resolve(root, 'src/client/host/online/shell.ts'), identity: resolve(root, 'src/client/app/identity.ts'), storage: resolve(root, 'src/client/engine/saves/view/storage.ts') },
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: `${directory}/[name].js` },
      },
    },
  });
}
