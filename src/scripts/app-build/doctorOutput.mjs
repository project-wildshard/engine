/** E7.5 prep (Jake, 2026-11-09): the Connection doctor's own page, `doctor/index.html`, in its own module graph beside the
 * client, as the standalone shell is (standaloneOutput.mjs). In the client's graph it would share chunks with the game, so
 * its page would preload the game's code and stylesheet, and its entry would move the title's chunk lines. Its own build
 * keeps it small and leaves the client's chunks and budgets alone. Runs before the documents are stamped, which stamp it too. */
import { resolve } from 'node:path';
import { build } from 'vite';
import { BUILD_ID_EXPRESSION, codeDirectory } from './buildIdentity.mjs';

/** @param {string} outDir @param {string} buildId @param {string} root */
export async function writeDoctorOutput(outDir, buildId, root) {
  await build({
    configFile: false, root, logLevel: 'warn', publicDir: false,
    define: { __BUILD_ID__: BUILD_ID_EXPRESSION },
    build: {
      outDir: resolve(outDir), emptyOutDir: false, assetsDir: `${codeDirectory(buildId)}/doctor`, target: 'es2022', sourcemap: false, reportCompressedSize: false, manifest: false, modulePreload: false,
      rolldownOptions: { input: { doctor: resolve(root, 'doctor/index.html') } },
    },
  });
}
