import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {judgePageEvents, scanListeners} from '../../scripts/check-page-events.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

/**
 * A tree with one page listener, its page producer, a server copy of the producer and a flow that proves the listener.
 * @returns {{root: string, put: (path: string, source: string) => void}}
 */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'page-events-'));
  roots.push(root);
  /** @param {string} path @param {string} source */
  const put = (path, source) => { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), source); };
  put('package.json', JSON.stringify({name: '@fixture/engine', exports: {'./bus': './src/shared/bus.ts'}}));
  put('index.html', '<script type="module" src="/src/client/entry.ts"></script>');
  put('src/shared/bus.ts', 'export const bus = { on(): void {}, emit(): void {} };\n');
  put('src/client/entry.ts', "import { bus } from '@fixture/engine/bus';\nimport './hud.ts';\nimport { land } from './wire.ts';\nland(bus);\n");
  put('src/client/hud.ts', "import { bus } from '@fixture/engine/bus';\nbus.on('creature.died', () => {});\nexport {};\n");
  put('src/client/wire.ts', "export function land(bus: { emit(name: string): void }): void { bus.emit('creature.died'); }\n");
  put('src/server/worker.ts', "import { land } from './sim.ts';\nland();\n");
  put('src/server/sim.ts', "export function land(): void { host.emit('creature.died'); }\n");
  put('scripts/worker-client-play.mjs', "if (runs('creature-hit')) {}\n");
  return {root, put};
}

/** @param {Record<string, unknown>} [row] @param {unknown[]} [ignore] */
const table = (row = {}, ignore = []) => ({
  about: 'fixture',
  entries: {page: ['index.html'], host: ['src/server/worker.ts']},
  rows: [{id: 'creature.died', kind: 'event', name: 'creature.died', bus: 'page', listeners: ['src/client/hud.ts'],
    producers: [{file: 'src/client/wire.ts', emits: "bus.emit('creature.died')"}], proof: 'flow:creature-hit', ...row}],
  ignore,
});

/** @param {string} root @param {ReturnType<typeof table>} t @returns {string[]} */
const judge = (root, t) => judgePageEvents(root, /** @type {any} */ (t)).failures;

describe('check:page-events (SR12)', () => {
  test('a listener with a reached page producer and a real flow is green', () => {
    const {root} = tree();
    expect(judge(root, table())).toEqual([]);
  });

  test('finds literal, dynamic and tap listeners, never in a test file', () => {
    const {root, put} = tree();
    put('src/client/look.ts', 'declare const ctx: { on(n: string, f: () => void): void };\ndeclare const name: string;\ndeclare const animals: { onKill?: () => void };\nctx.on(name, () => {});\nanimals.onKill = () => {};\n');
    put('src/client/hud.test.ts', "bus.on('creature.died', () => {});\n");
    const sites = scanListeners(root).map(({file, kind, name}) => `${file} ${kind} ${name}`);
    expect(sites).toEqual(['src/client/hud.ts event creature.died', 'src/client/look.ts dynamic ctx', 'src/client/look.ts tap onKill']);
  });

  test('red on a new listener with no row', () => {
    const {root, put} = tree();
    put('src/client/feed.ts', "import { bus } from '@fixture/engine/bus';\nbus.on('creature.died', () => {});\n");
    expect(judge(root, table())).toEqual([expect.stringMatching(/^src\/client\/feed\.ts:2 listens to event creature\.died with no row/u)]);
  });

  test('red on a row whose producer is gone', () => {
    const {root, put} = tree();
    expect(judge(root, table({producers: [{file: 'src/client/gone.ts', emits: 'x'}]}))).toEqual(['row creature.died: producer src/client/gone.ts is gone']);
    put('src/client/wire.ts', 'export function land(): void {}\n');
    expect(judge(root, table())).toEqual(["row creature.died: producer src/client/wire.ts no longer has `bus.emit('creature.died')`"]);
  });

  test('red on a producer only tests reach', () => {
    const {root, put} = tree();
    put('src/client/legacyHurt.ts', "export function hurt(bus: { emit(name: string): void }): void { bus.emit('creature.died'); }\n");
    put('src/client/legacyHurt.test.ts', "import { hurt } from './legacyHurt.ts';\nhurt({ emit() {} });\n");
    expect(judge(root, table({producers: [{file: 'src/client/legacyHurt.ts', emits: "bus.emit('creature.died')"}]})))
      .toEqual(['row creature.died: producer src/client/legacyHurt.ts is reached only by tests, not from a production page entry']);
    expect(judge(root, table({producers: [{file: 'src/client/legacyHurt.test.ts', emits: 'hurt('}]})))
      .toEqual(['row creature.died: producer src/client/legacyHurt.test.ts is test code, not a production producer']);
  });

  test('red on a page listener whose producer moved to the server', () => {
    const {root} = tree();
    expect(judge(root, table({producers: [{file: 'src/server/sim.ts', emits: "host.emit('creature.died')"}]})))
      .toEqual(['row creature.died: producer src/server/sim.ts runs only on the server, never on the page']);
    expect(judge(root, table({bus: 'host', producers: [{file: 'src/server/sim.ts', emits: "host.emit('creature.died')"}]})))
      .toEqual(["row creature.died: src/client/hud.ts is page code, so its row's bus must be page"]);
  });

  test('red on an unknown flow, a local proof off the page, an ignore matching nothing, and a stale listener', () => {
    const {root, put} = tree();
    expect(judge(root, table({proof: 'flow:nowhere'}))).toEqual(['row creature.died: proof flow nowhere is not one worker-client-proof runs']);
    expect(judge(root, table({proof: 'local', why: 'x', producers: [{file: 'src/shared/bus.ts', emits: 'emit()'}]})))
      .toEqual([expect.stringMatching(/^row creature\.died: a local proof needs .* every producer in src\/client \(not src\/shared\/bus\.ts\)$/u)]);
    expect(judge(root, table({}, [{file: 'src/client/hud.ts', name: 'click', why: 'DOM'}]))).toEqual(['ignore src/client/hud.ts click matches nothing: drop it']);
    put('src/client/hud.ts', 'export {};\n');
    expect(judge(root, table())).toEqual(['row creature.died: src/client/hud.ts no longer listens to event creature.died: drop it from the row']);
  });
});
