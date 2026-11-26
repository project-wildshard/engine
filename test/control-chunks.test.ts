import { expect, test } from 'vitest';
import { controlChunkSelector, controlChunkFileName } from '../src/scripts/app-build/controlChunks';
import { readModuleFiles } from '../src/client/engine/boot/download';

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

test('a shared chunk named after the checkout folder gets one fixed name, so its importers are the same bytes everywhere', () => {
  expect(controlChunkFileName({ name: 'engine' }, 'b/c', 'engine')).toBe('b/c/shared-[hash].js');
  expect(controlChunkFileName({ name: 'engine-source' }, 'b/c', 'engine-source')).toBe('b/c/shared-[hash].js');
  expect(controlChunkFileName({ name: 'late' }, 'b/c', 'engine')).toBe('b/c/late-[hash].js');
});
