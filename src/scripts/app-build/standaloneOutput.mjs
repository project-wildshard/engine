/** E5.4's pointer half (J129): the standalone shell and its server worker beside the client, under the build's folder. The
 * page client loads them by URL at runtime, so they get their own bundle and leave its chunks and budgets alone.
 * standalone-smoke plays this output. Runs before the service worker, which precaches it. */
import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { build } from 'vite';
import { rapierAlias } from '../../../vite/rapier.ts';
import { BUILD_ID_EXPRESSION, CODE_ROOTS, codeDirectory, engineVersionOf } from './buildIdentity.mjs';
import { engineRelease } from '../changelog.mjs';

/** Where a build's emitted shell is served from.
 * @param {string} buildId @param {string} [engineVersion] */
export const standaloneDirectory = (buildId, engineVersion) => `${codeDirectory(buildId, engineVersion)}/standalone`;

/** @param {string} path */
export const standaloneServerFile = path => /^(?:builds\/[^/]+|b)\/[^/]+\/standalone\/(?:shell\.js|server(?:Worker|Runtime)[^/]*\.js)$/u.test(path);

/** Check the complete output, including previous deploy chunks.
 * @param {string} outDir @param {boolean} preview */
export function checkServerOutput(outDir, preview) {
  // PV9: this build's folder and the carried ones, in either layout (`builds/` or the legacy `b/`)
  const files = CODE_ROOTS.map(name => resolve(outDir, name)).flatMap(root => existsSync(root) ? readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(row => row.isFile()).map(row => relative(outDir, resolve(row.parentPath, row.name))) : []);
  const server = files.filter(standaloneServerFile);
  if (!preview && server.length > 0) throw new Error(`Unexpected in-page server output: ${server.join(', ')}`);
  if (preview && !server.some(path => /\/serverWorker[^/]*\.js$/u.test(path))) throw new Error('Solo build has no server worker');
}

/** @param {string} outDir @param {string} buildId @param {string} root @param {{ preview?: boolean, devserver?: boolean }} [options] */
export async function writeStandaloneOutput(outDir, buildId, root, options = {}) {
  const directory = standaloneDirectory(buildId, engineVersionOf(root));
  await build({
    configFile: false, root, logLevel: 'warn', publicDir: false, resolve: { alias: rapierAlias }, assetsInclude: ['**/*.bin', '**/*.wasm'],
    // SENTRY-TRIAGE S5: the shells report errors too, under the same wildshard@<version> release as the page
    // SHARD-SOURCE AP5: the shell and the server worker read `__DEVSERVER__` too (the dev hook's server half); a production
    // build folds it to false here as the page bundle does (src/scripts/check-devserver.mjs refuses one left unsubstituted)
    define: { __TITLE_ASSET_URLS__: '{}', __BUILD_ID__: BUILD_ID_EXPRESSION, __ENGINE_RELEASE__: JSON.stringify(engineRelease(root)), __DEVSERVER__: JSON.stringify(options.devserver === true) }, worker: { format: 'es' },
    build: {
      outDir: resolve(outDir), emptyOutDir: false, assetsDir: directory, target: 'es2022', sourcemap: false, reportCompressedSize: false,
      rolldownOptions: {
        // identity and storage: what a page entry installs, in the shell's own module graph, for a page that isn't this bundle
        input: { ...(options.preview === true ? { shell: resolve(root, 'src/client/host/standalone/shell.ts') } : {}), online: resolve(root, 'src/client/host/online/shell.ts'), identity: resolve(root, 'src/client/app/identity.ts'), storage: resolve(root, 'src/client/engine/saves/view/storage.ts') },
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: `${directory}/[name].js` },
      },
    },
  });
}
