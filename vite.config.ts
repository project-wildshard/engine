import { defineConfig } from 'vite';
import { assetTableAddresses, readAssetTables } from './scripts/app-build/assetTables.mjs';
import { readGridSeams } from './scripts/app-build/gridSeams.mjs';
import { readFileSync } from 'node:fs';
import { shardfileValidationRevision } from './scripts/shardfile-validation-revision.mjs';
import { join } from 'node:path';
import { rapierAlias } from './vite/rapier';
import { assertHeavyLease } from './scripts/heavy-lane-lease.mjs';
import { buildValidationReceipts } from './scripts/app-build/validationReceipts.mjs';
import { BUILD_ID_EXPRESSION, VALIDATOR_EXPRESSION, VERDICTS_EXPRESSION, SHARED_CODE_DIRECTORY, codeDirectory } from './scripts/app-build/buildIdentity.mjs';
import { controlChunkGroups, controlChunkFileName } from './scripts/app-build/controlChunks';

/** The world map atlas's define, as scripts/app-build/worldMapAtlas.ts baked it before the bundle. */
function worldMapDefine(): unknown {
  let rows: string;
  try { rows = readFileSync('out/.app/world-map.json', 'utf8'); }
  catch { throw new Error('Missing out/.app/world-map.json: build the app through scripts/build-app.mjs, which bakes the world map first'); }
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
    server: { port: 5173, host: true },
    // js-payload D2 (Jake): on-phone stacks show Rolldown's mangled names; hidden source maps resolve them on desktop
    // one stylesheet: src/client/app/entry.ts splits three.js from the game's graph, and code-split CSS would add a request
    build: {
      // build-app publishes public files after bundling, omitting the obsolete
      // shardfiles tree that final product publication replaces (G799: no plugin).
      copyPublicDir: process.env['WS_APP_DEFER_PUBLIC_COPY'] !== '1',
      // The mandatory chunk report measures and gates gzip bytes after this web build.
      assetsDir: code, target: 'es2022', reportCompressedSize: false, chunkSizeWarningLimit: 4000, sourcemap: 'hidden' as const, cssCodeSplit: false, manifest: true,
      // G221: standalone CLI calibration, never a game-entry or Developer switch.
      rolldownOptions: {
        input: { main: join(process.cwd(), 'index.html'), calibration: join(process.cwd(), 'calibration/index.html') },
        preserveEntrySignatures: false,
        output: {
          strictExecutionOrder: true, chunkFileNames: chunk => controlChunkFileName(chunk, shared),
          assetFileNames: asset => `${asset.names.some(name => /\.(?:js|css|wasm)$/u.test(name)) ? shared : 'assets'}/[name]-[hash][extname]`,
          codeSplitting: { groups: controlChunkGroups(process.cwd()) },
        },
      },
    },
    assetsInclude: ['**/*.hdr', '**/*.gltf', '**/*.bin'],
    resolve: { alias: rapierAlias }, // Rapier's wasm-importing module → plain bindings (vite/rapier.ts)
    define: { __TITLE_ASSET_URLS__: readFileSync('scripts/title-assets.generated.json', 'utf8'), __GRID_SEAM_ASSET__: JSON.stringify(readGridSeams(process.cwd()).address), __BOOT_TABLE_ASSETS__: JSON.stringify(assetTableAddresses(readAssetTables(process.cwd()))), __GRID_MAP_ATLAS__: JSON.stringify(worldMapDefine()), __SHARDFILE_VALIDATOR__: VALIDATOR_EXPRESSION, __SHARDFILE_VERDICTS__: VERDICTS_EXPRESSION, __DEVSERVER__: mode === 'devserver', __BUILD_ID__: BUILD_ID_EXPRESSION },
  };
});
