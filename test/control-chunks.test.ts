import { expect, test } from 'vitest';
import { controlChunkSelector, controlChunkFileName, controlChunkGroups } from '../scripts/app-build/controlChunks';
import { build } from 'vite';
import { writtenBundle } from '../scripts/app-build/writtenBundle';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the owned miniature emitted-entry fixture.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Create and remove only this test's miniature build files.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readModuleFiles } from '../src/client/engine/boot/download';
import { bootModuleFiles } from '../scripts/app-build/bootModules';

test('control batches retain title, session, lazy and shard boundaries through cycles', () => {
  const root = '/fixture';
  const edges: Readonly<Record<string, readonly string[]>> = {
    '/fixture/src/client/app/entry.ts': ['/fixture/src/shared.ts'],
    '/fixture/src/client/game/session/session.ts': ['/fixture/src/sessionOnly.ts', '/fixture/src/shared.ts'],
    '/fixture/src/core.ts': ['/fixture/src/client/game/session/session.ts', '/fixture/src/services.ts', '/fixture/src/shards/one/manifest.ts'],
    '/fixture/src/services.ts': ['/fixture/src/core.ts'],
  };
  const graph = { getModuleInfo: (id: string) => ({ importedIds: edges[id] ?? [] }) };
  const select = controlChunkSelector(root, ['/fixture/src/client/app/entry.ts', '/fixture/src/core.ts']);
  expect(select('/fixture/src/shared.ts', graph)).toBeNull();
  expect(select('/fixture/src/client/app/entry.ts', graph)).toBeNull();
  expect(select('/fixture/src/sessionOnly.ts', graph)).toMatch(/^control-.*-session$/u);
  expect(select('/fixture/src/services.ts', graph)).toMatch(/^control-.*-startup$/u);
  expect(select('/fixture/src/lazyExplorer.ts', graph)).toBeNull();
  expect(select('/fixture/src/calibration.ts', graph)).toBeNull();
  expect(select('/fixture/src/shards/one/manifest.ts', graph)).toBeNull();
  expect(select('/fixture/src/styles.css', graph)).toBeNull();
  const title = controlChunkSelector(root, [], 'title');
  expect(title('/fixture/src/shared.ts', graph)).not.toBeNull();
  expect(title('/fixture/src/services.ts', graph)).toBeNull();
});

test('a subsequent build uses its own graph, including changed optional requirements', () => {
  const graph = { getModuleInfo: () => ({ importedIds: [] }) };
  const first = controlChunkSelector('/fixture', ['/fixture/src/first.ts']);
  const second = controlChunkSelector('/fixture', ['/fixture/src/second.ts']);
  expect(first('/fixture/src/first.ts', graph)).toMatch(/^control-.*-startup$/u);
  expect(first('/fixture/src/second.ts', graph)).toBeNull();
  expect(second('/fixture/src/first.ts', graph)).toBeNull();
  expect(second('/fixture/src/second.ts', graph)).toMatch(/^control-.*-startup$/u);
});

test('unconditional initial banks ignore later roles but preserve their exact HTML entry sets', () => {
  const root = '/fixture', rows: Readonly<Record<string, readonly string[]>> = {
    '/fixture/index.html': ['/fixture/src/client/app/entry.ts', '/fixture/src/bootOnly.ts', '/fixture/src/shared.ts', '/fixture/src/base.css'],
    '/fixture/calibration/index.html': ['/fixture/src/calibrationOnly.ts', '/fixture/src/shared.ts'],
    '/fixture/src/client/app/entry.ts': ['/fixture/src/titleAndSession.ts'],
    '/fixture/src/client/game/session/session.ts': ['/fixture/src/titleAndSession.ts', '/fixture/src/sessionOnly.ts'],
  };
  const graph = { getModuleInfo: (id: string) => ({ importedIds: rows[id] ?? [] }) };
  const select = controlChunkSelector(root, ['/fixture/src/client/app/entry.ts', '/fixture/src/client/game/session/session.ts'], 'initial');
  // bootOnly has no later role; titleAndSession has both. Main requires
  // them together even though their later masks differ.
  expect(select('/fixture/src/bootOnly.ts', graph)).toBe('entry-1');
  expect(select('/fixture/src/titleAndSession.ts', graph)).toBe('entry-1');
  expect(select('/fixture/src/client/app/entry.ts', graph)).toBe('entry-1');
  expect(select('/fixture/src/shared.ts', graph)).toBe('entry-3');
  expect(select('/fixture/src/calibrationOnly.ts', graph)).toBe('entry-2');
  expect(select('/fixture/src/sessionOnly.ts', graph)).toBeNull();
  expect(select('/fixture/src/lazyExplorer.ts', graph)).toBeNull();
  expect(select('/fixture/src/base.css', graph)).toBeNull();
});

test('entry-aware chunk labels preserve the strict named module bank contract', () => {
  const pattern = controlChunkFileName({ name: 'title-boundary~main~session' });
  expect(pattern).toBe('assets/title-boundary-main-session-[hash].js');
  const file = `/${pattern.replace('[hash]', '012345ab')}`;
  expect(readModuleFiles([[file, 42]])).toEqual([[file, 42]]);
  expect(() => readModuleFiles([['/assets/title~session.js', 42]])).toThrow('Invalid boot module file');
});

test('home batches combine equal requirements without admitting another home or Explorer', () => {
  const graph = { getModuleInfo: (id: string) => ({ importedIds: id === '/fixture/pine.ts' ? ['/fixture/pine-helper.ts'] : [] }) };
  const select = controlChunkSelector('/fixture', [], 'control', [
    ['/fixture/common.ts', '/fixture/pine.ts'], ['/fixture/common.ts', '/fixture/nalati.ts'],
  ]);
  expect(select('/fixture/pine.ts', graph)).toBe(select('/fixture/pine-helper.ts', graph));
  expect(select('/fixture/pine.ts', graph)).not.toBe(select('/fixture/nalati.ts', graph));
  expect(select('/fixture/common.ts', graph)).not.toBe(select('/fixture/pine.ts', graph));
  expect(select('/fixture/explorer.ts', graph)).toBeNull();
});

test('asset URL banks share exact phase requirements without merging shard code or late images', () => {
  const rows: Readonly<Record<string, readonly string[]>> = {
    '/fixture/home.ts': ['/fixture/src/shards/one/thumb.jpg', '/fixture/src/shards/two/thumb.jpg'],
    '/fixture/other.ts': ['/fixture/src/shards/one/thumb.jpg', '/fixture/src/shards/two/thumb.jpg', '/fixture/src/shards/three/only.png'],
  };
  const graph = { getModuleInfo: (id: string) => ({ importedIds: rows[id] ?? [] }) };
  const select = controlChunkSelector('/fixture', [], 'assets', [['/fixture/home.ts'], ['/fixture/other.ts']]);
  const first = select('/fixture/src/shards/one/thumb.jpg', graph);
  expect(first).toMatch(/^asset-urls-/u);
  expect(select('/fixture/src/shards/two/thumb.jpg', graph)).toBe(first);
  expect(select('/fixture/src/shards/three/only.png', graph)).not.toBe(first);
  expect(select('/fixture/src/shards/one/late.png', graph)).toBeNull();
  expect(select('/fixture/src/shards/one/gameplay.ts', graph)).toBeNull();
});

test('phase banks keep initial and late code isolated and retain unchanged control bytes', async () => {
  mkdirSync('tmp/control-chunks', { recursive: true });
  const root = mkdtempSync(resolve('tmp/control-chunks/entries-'));
  try {
    for (const folder of ['src/client/engine/ui', 'src/client/engine/app', 'src/shared/engine/app', 'src/server/engine/app', 'src/client/game/grid', 'src/shared/game/grid', 'src/server/game/grid', 'src/client/game/travel', 'src/client/game/shardfile', 'src/shared/game/shardfile', 'src/server/game/shardfile', 'calibration']) mkdirSync(resolve(root, folder), { recursive: true });
    writeFileSync(resolve(root, 'index.html'), '<script type="module" src="/src/client/app/entry.ts"></script>');
    writeFileSync(resolve(root, 'calibration/index.html'), '<script type="module" src="/calibration/entry.ts"></script>');
    writeFileSync(resolve(root, 'calibration/entry.ts'), 'import {runtime} from "../src/client/engine/app/runtime"; globalThis.calibration = runtime;');
    writeFileSync(resolve(root, 'src/client/engine/app/runtime.ts'), 'globalThis.runtimeStarted = performance.now(); export const runtime = globalThis.runtimeStarted;');
    writeFileSync(resolve(root, 'src/rows.json'), '{"rows":[[1,2],[3,4]]}');
    writeFileSync(resolve(root, 'src/core.ts'), 'import {runtime} from "./engine/client/app/runtime"; import rows from "./rows.json"; export const control = {runtime, rows};');
    writeFileSync(resolve(root, 'src/client/game/grid/session.ts'), 'export const grid = true;');
    writeFileSync(resolve(root, 'src/client/game/shardfile/client.ts'), 'export const client = true;');
    writeFileSync(resolve(root, 'src/optional.ts'), 'globalThis.optionalValue = "first late value";');
    const title = ['engine/client/ui/StartTitle', 'game/client/mainMenu', 'game/client/grid/pageEntry', 'game/client/travel/travel'];
    for (const file of title) writeFileSync(resolve(root, `src/${file}.ts`), 'export const label = "title";');
    writeFileSync(resolve(root, 'src/client/app/entry.ts'), `async function startSelected(){return Promise.all([import('./core'),import('./rows.json')]);}
      globalThis.launch = startSelected; globalThis.optional = () => import('./optional');
      globalThis.grid = () => import('./game/client/grid/session');
      globalThis.title = () => Promise.all([${title.map(file => `import('./${file}')`).join(',')}]);`);
    const outDir = resolve(root, 'dist');
    await build({ root, configFile: false, logLevel: 'silent', build: { outDir, manifest: true, sourcemap: 'hidden', cssCodeSplit: false,
      rolldownOptions: { input: { main: resolve(root, 'index.html'), calibration: resolve(root, 'calibration/index.html') },
        preserveEntrySignatures: false, output: { strictExecutionOrder: true, chunkFileNames: controlChunkFileName,
          codeSplitting: { groups: controlChunkGroups(root) } } } } });
    const bundle = writtenBundle(outDir, root);
    const modules = (entry: string): Set<string> => {
      const pending = Object.entries(bundle).filter(([, file]) => file.facadeModuleId === resolve(root, entry)).map(([name]) => name);
      expect(pending).toHaveLength(1);
      const found = new Set<string>(), names = new Set<string>();
      while (pending.length > 0) {
        const name = pending.pop();
        if (name === undefined || found.has(name)) continue;
        found.add(name); const file = bundle[name];
        if (file === undefined) throw new Error('Missing actual emitted dependency');
        pending.push(...file.imports ?? []);
        for (const id of Object.keys(file.modules ?? {})) names.add(id);
      }
      return names;
    };
    const runtime = resolve(root, 'src/client/engine/app/runtime.ts');
    expect(modules('index.html').has(runtime)).toBe(false);
    expect(modules('calibration/index.html').has(runtime)).toBe(true);
    const optional = resolve(root, 'src/optional.ts'), control = resolve(root, 'src/core.ts');
    expect(modules('index.html').has(optional)).toBe(false);
    expect(modules('calibration/index.html').has(optional)).toBe(false);
    expect(bootModuleFiles(bundle, [resolve(root, 'src/rows.json')]).length).toBeGreaterThan(0);
    expect(Object.entries(bundle).filter(([, file]) => Object.hasOwn(file.modules ?? {}, resolve(root, 'src/rows.json')))
      .map(([name]) => name)).toHaveLength(1);
    expect(Object.entries(bundle).find(([, file]) => Object.hasOwn(file.modules ?? {}, resolve(root, 'src/rows.json')))?.[0])
      .toMatch(/\/startup-data-/u);
    const grid = resolve(root, 'src/client/game/grid/session.ts');
    const gridBank = Object.entries(bundle).find(([, file]) => Object.hasOwn(file.modules ?? {}, grid));
    expect(gridBank?.[0]).toMatch(/\/grid-session-/u);
    expect(Object.keys(gridBank?.[1].modules ?? {})).toEqual([grid]);
    const controlBytes = (files: typeof bundle): readonly string[] => Object.entries(files)
      .filter(([, file]) => Object.hasOwn(file.modules ?? {}, control)).map(([name, file]) => `${name}\n${file.code}`).sort();
    const before = controlBytes(bundle);
    expect(before.length).toBeGreaterThan(0);
    writeFileSync(resolve(root, 'src/optional.ts'), 'globalThis.optionalValue = "changed late value";');
    await build({ root, configFile: false, logLevel: 'silent', build: { outDir, manifest: true, sourcemap: 'hidden', cssCodeSplit: false,
      rolldownOptions: { input: { main: resolve(root, 'index.html'), calibration: resolve(root, 'calibration/index.html') },
        preserveEntrySignatures: false, output: { strictExecutionOrder: true, chunkFileNames: controlChunkFileName,
          codeSplitting: { groups: controlChunkGroups(root) } } } } });
    expect(controlBytes(writtenBundle(outDir, root))).toEqual(before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a shared chunk named after the checkout folder gets one fixed name, so its importers are the same bytes everywhere', () => {
  expect(controlChunkFileName({ name: 'engine' }, 'b/c', 'engine')).toBe('b/c/shared-[hash].js');
  expect(controlChunkFileName({ name: 'engine-source' }, 'b/c', 'engine-source')).toBe('b/c/shared-[hash].js');
  expect(controlChunkFileName({ name: 'late' }, 'b/c', 'engine')).toBe('b/c/late-[hash].js');
});
