import { defineConfig } from 'vite';
import { assetTableAddresses, readAssetTables } from './src/scripts/app-build/assetTables.mjs';
import { readGridSeams } from './src/scripts/app-build/gridSeams.mjs';
import { readFileSync } from 'node:fs';
import { shardfileValidationRevision } from './src/scripts/shardfile-validation-revision.mjs';
import { join, basename } from 'node:path';
import { rapierAlias } from './vite/rapier';
import { valibotStandardPlugin } from './vite/valibotStandard';
import { heldShaderStagesPlugin } from './vite/threeHeldShaderStages';
import { sideBlindProgramsPlugin } from './vite/threeSideBlindPrograms';
import { viteTmpRoot } from './src/scripts/.kit/vite-tmp.mjs';
import { assertHeavyLease } from './src/scripts/heavy-lane-lease.mjs';
import { buildValidationReceipts } from './src/scripts/app-build/validationReceipts.mjs';
import { BUILD_ID_EXPRESSION, VALIDATOR_EXPRESSION, VERDICTS_EXPRESSION, SHARED_CODE_DIRECTORY, codeDirectory } from './src/scripts/app-build/buildIdentity.mjs';
import { controlChunkGroups, controlChunkFileName } from './src/scripts/app-build/controlChunks';
import { engineRelease } from './src/scripts/changelog.mjs';
import { entryStamp } from './src/scripts/app-build/builtAt.mjs';
import { worktreeWatchIgnored } from './src/scripts/.kit/worktree-ignore.mjs';

/** The world map atlas's define, as src/scripts/app-build/worldMapAtlas.ts baked it before the bundle. */
function worldMapDefine(): unknown {
  let rows: string;
  try { rows = readFileSync('out/.app/world-map.json', 'utf8'); }
  catch { throw new Error('Missing out/.app/world-map.json: build the app through src/scripts/build-app.mjs, which bakes the world map first'); }
  return (JSON.parse(rows) as { define: unknown }).define;
}

export default defineConfig(({ mode, command }) => {
  if (command === 'build') assertHeavyLease('build');
  // J57, J131: the web build's code, CSS and wasm go under its immutable folder; build-app mints the id. Other emitted
  // files are content-named and stay under /assets/.
  const build = process.env['WS_BUILD_ID'], code = build === undefined ? 'assets' : codeDirectory(build);
  // J217 (LD6): non-entry chunks, CSS and wasm are named by content in a folder every build shares; the entry stays in `code`
  const shared = build === undefined ? 'assets' : SHARED_CODE_DIRECTORY;
  const validationRevision = shardfileValidationRevision();
  buildValidationReceipts(validationRevision); // Fail before bundling on any stale or missing product.
  return {
    // DF11 (mini-df11g): valibot's Standard Schema glue is built on first read, two fewer heap cells per schema
    // DF8 (mini-df8): a live custom program can hold its shader stages (`debug.programReuse`, off by default); depth and
    // unlit programs can key without side or normals (`debug.programTwins`, mini-dwfps2)
    plugins: [viteTmpRoot({ janitor: join(process.cwd(), 'src/scripts/temp-janitor.mjs') }), valibotStandardPlugin(), heldShaderStagesPlugin(), sideBlindProgramsPlugin()],
    // DS11: plan worktrees under .worktrees/ are other checkouts; the dev watcher never follows them
    server: { port: 5173, host: true, watch: { ignored: worktreeWatchIgnored() } },
    // js-payload D2 (Jake): on-phone stacks show Rolldown's mangled names; hidden source maps resolve them on desktop
    // one stylesheet: src/client/app/entry.ts splits three.js from the game's graph, and code-split CSS would add a request
    build: {
      // build-app publishes public files after bundling, omitting the obsolete
      // shardfiles tree that final product publication replaces (G799: no plugin).
      copyPublicDir: process.env['WS_APP_DEFER_PUBLIC_COPY'] !== '1',
      // The mandatory chunk report measures and gates gzip bytes after this web build.
      assetsDir: code, target: 'es2022', reportCompressedSize: false, chunkSizeWarningLimit: 4000, sourcemap: 'hidden' as const, cssCodeSplit: false, manifest: true,
      // J217 (LD6b): a chunk names its imports by stable import-map keys, not their hashes, so one changed module renames
      // only its own chunk (src/scripts/app-build/importMap.mjs checks the map)
      chunkImportMap: true,
      // G221: standalone CLI calibration, never a game-entry or Developer switch.
      rolldownOptions: {
        input: { main: join(process.cwd(), 'index.html'), calibration: join(process.cwd(), 'calibration/index.html') },
        preserveEntrySignatures: false,
        output: {
          strictExecutionOrder: true, chunkFileNames: chunk => controlChunkFileName(chunk, shared, basename(process.cwd())),
          assetFileNames: asset => `${asset.names.some(name => /\.(?:js|css|wasm)$/u.test(name)) ? shared : 'assets'}/[name]-[hash][extname]`,
          codeSplitting: { groups: controlChunkGroups(process.cwd()) },
          // STALE-BUILD SB1/SB3 (J321): the page's own entry carries its build time and the age check (app-build/builtAt.mjs)
          banner: chunk => chunk.isEntry && chunk.name === 'main' ? entryStamp(process.env['WS_BUILT_AT']) : '',
        },
      },
    },
    // J217 (LD6): a worker is content-named code too; in the build's folder, every chunk that starts one renamed each deploy
    worker: { rolldownOptions: { output: { entryFileNames: `${shared}/[name]-[hash].js`, chunkFileNames: `${shared}/[name]-[hash].js` } } },
    assetsInclude: ['**/*.hdr', '**/*.gltf', '**/*.bin'],
    resolve: { alias: rapierAlias }, // Rapier's wasm-importing module → plain bindings (vite/rapier.ts)
    define: { __TITLE_ASSET_URLS__: readFileSync('src/scripts/title-assets.generated.json', 'utf8'), __GRID_SEAM_ASSET__: JSON.stringify(readGridSeams(process.cwd()).address), __BOOT_TABLE_ASSETS__: JSON.stringify(assetTableAddresses(readAssetTables(process.cwd()))), __GRID_MAP_ATLAS__: JSON.stringify(worldMapDefine()), __SHARDFILE_VALIDATOR__: VALIDATOR_EXPRESSION, __SHARDFILE_VERDICTS__: VERDICTS_EXPRESSION, __DEVSERVER__: mode === 'devserver', __PREPARATION_ONLY__: process.env['WILDSHARD_PREPARATION_ONLY'] === '1', __BUILD_ID__: BUILD_ID_EXPRESSION,
      // Jake 2026-11-10: the title names the engine version and lists its CHANGELOG.md section (src/scripts/changelog.mjs)
      __ENGINE_RELEASE__: JSON.stringify(engineRelease(process.cwd())) },
  };
});
