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
  put('index.html', '<script src="/src/client/entry.ts" type="module"></script>');
  put('src/shared/bus.ts', 'export const bus = { on(): void {}, emit(): void {} };\n');
  put('src/client/entry.ts', "import { bus } from '@fixture/engine/bus';\nimport './hud.ts';\nimport { land } from './wire.ts';\nland(bus);\n");
  put('src/client/hud.ts', "import { bus } from '@fixture/engine/bus';\nbus.on('creature.died', () => {});\nexport {};\n");
  put('src/client/wire.ts', "export function land(bus: { emit(name: string): void }): void { bus.emit('creature.died'); }\n");
  put('src/server/worker.ts', "import { land } from './sim.ts';\nland();\n");
  put('src/server/sim.ts', "export function land(): void { host.emit('creature.died'); }\n");
  put('scripts/worker-client-proof.mjs', "const { play } = await import('./worker-client-play.mjs');\nplay();\n");
  put('scripts/worker-client-play.mjs', "export function play() { if (runs('creature-hit')) {} }\n");
  put('scripts/worker-client-orphan.mjs', "if (runs('orphan')) {}\n");
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
const UNREACHED = 'is not reachable from the production page entries (only tests, or nothing, load it)';

describe('check:page-events (SR12)', () => {
  test('a listener with a reached, called page producer and a real flow is green', () => {
    const {root} = tree();
    expect(judge(root, table())).toEqual([]);
  });

  test('finds every subscription shape, and not the panel API, a cleared tap or a test file', () => {
    const {root, put} = tree();
    put('src/client/look.ts', [
      'declare const ctx: { on(n: string, f: () => void): void }; declare const name: string;',
      'declare const animals: { onKill?: () => void; onSound?: () => void }; declare const view: { on(r: string, t: string, f: () => void): void };',
      'declare const reactions: { on(n: string, f: () => void): void };',
      'ctx.on(name, () => {});', "ctx['on']('creature.signal', () => {});", 'reactions.on(name, () => {});',
      'animals.onKill = () => {};', "animals['onSound'] = () => {};", 'animals.onSound = undefined;', "view.on('close', 'click', () => {});",
    ].join('\n'));
    put('src/client/hud.test.ts', "bus.on('creature.died', () => {});\n");
    expect(scanListeners(root).map(({file, kind, name}) => `${file} ${kind} ${name}`)).toEqual([
      'src/client/hud.ts event creature.died', 'src/client/look.ts dynamic ctx', 'src/client/look.ts event creature.signal',
      'src/client/look.ts dynamic reactions', 'src/client/look.ts tap onKill', 'src/client/look.ts tap onSound',
    ]);
  });

  test('red on a new listener with no row', () => {
    const {root, put} = tree();
    put('src/client/feed.ts', "import { bus } from '@fixture/engine/bus';\nbus.on('creature.died', () => {});\n");
    expect(judge(root, table())).toEqual([expect.stringMatching(/^src\/client\/feed\.ts:2 listens to event creature\.died with no row/u)]);
  });

  test('red on a row whose producer is gone, even when its text survives in a comment', () => {
    const {root, put} = tree();
    expect(judge(root, table({producers: [{file: 'src/client/gone.ts', emits: 'x'}]}))).toEqual(['row creature.died: producer src/client/gone.ts is gone']);
    put('src/client/wire.ts', "// was: bus.emit('creature.died')\nexport function land(): void {}\n");
    expect(judge(root, table())).toEqual(["row creature.died: producer src/client/wire.ts no longer has `bus.emit('creature.died')` in its code"]);
  });

  test('red on a producer only tests reach, by file or by the function that emits', () => {
    const {root, put} = tree();
    put('src/client/legacyHurt.ts', "export function hurt(bus: { emit(name: string): void }): void { bus.emit('creature.died'); }\n");
    put('src/client/legacyHurt.test.ts', "import { hurt } from './legacyHurt.ts';\nhurt({ emit() {} });\n");
    expect(judge(root, table({producers: [{file: 'src/client/legacyHurt.ts', emits: "bus.emit('creature.died')"}]})))
      .toEqual([`row creature.died: producer src/client/legacyHurt.ts ${UNREACHED}`]);
    expect(judge(root, table({producers: [{file: 'src/client/legacyHurt.test.ts', emits: 'hurt('}]})))
      .toEqual(['row creature.died: producer src/client/legacyHurt.test.ts is test code, not a production producer']);
    // The file is loaded for another export, but the emitting function is only a test's.
    put('src/client/wire.ts', "export function land(): void {}\nexport function legacyLand(bus: { emit(name: string): void }): void { bus.emit('creature.died'); }\n");
    put('src/client/entry.ts', "import { land } from './wire.ts';\nimport './hud.ts';\nland();\n");
    put('src/client/wire.test.ts', "import { legacyLand } from './wire.ts';\nlegacyLand({ emit() {} });\n");
    expect(judge(root, table())).toEqual(['row creature.died: producer src/client/wire.ts emits inside legacyLand, which no production page code names']);
  });

  test('red on a producer in another realm: the server, a worker, a lazy or raw glob', () => {
    const {root, put} = tree();
    expect(judge(root, table({producers: [{file: 'src/server/sim.ts', emits: "host.emit('creature.died')"}]})))
      .toEqual(['row creature.died: producer src/server/sim.ts runs only on the server, never on the page']);
    expect(judge(root, table({bus: 'host', producers: [{file: 'src/server/sim.ts', emits: "host.emit('creature.died')"}]})))
      .toEqual(["row creature.died: src/client/hud.ts is page code, so its row's bus must be page"]);
    put('src/client/workerSide.ts', "bus.emit('creature.died');\n");
    put('src/client/rows/a.ts', "bus.emit('creature.died');\n");
    put('src/client/entry.ts', [
      "import { bus } from '@fixture/engine/bus';", "import './hud.ts';", "import { land } from './wire.ts';", 'land(bus);',
      "new Worker(new URL('./workerSide.ts', import.meta.url));",
      "import.meta.glob('./rows/*.ts');", "import.meta.glob('./rows/*.ts', { eager: true, query: '?raw' });",
    ].join('\n'));
    for (const file of ['src/client/workerSide.ts', 'src/client/rows/a.ts']) {
      expect(judge(root, table({producers: [{file, emits: "bus.emit('creature.died')"}]}))).toEqual([`row creature.died: producer ${file} ${UNREACHED}`]);
    }
    put('src/client/entry.ts', "import './hud.ts';\nimport.meta.glob('./rows/*.ts', { eager: true });\n");
    expect(judge(root, table({producers: [{file: 'src/client/rows/a.ts', emits: "bus.emit('creature.died')"}]}))).toEqual([]);
  });

  test('red on a flow no dispatcher runs, a local proof off the page, an ignore matching nothing, and a stale listener', () => {
    const {root, put} = tree();
    expect(judge(root, table({proof: 'flow:orphan'}))).toEqual(['row creature.died: proof flow orphan is not one scripts/worker-client-proof.mjs dispatches']);
    expect(judge(root, table({proof: 'scripts'}))).toEqual(['row creature.died: proof scripts is neither flow:<name>, local, nor an existing repo script']);
    expect(judge(root, table({proof: 'local', why: 'x', producers: [{file: 'src/shared/bus.ts', emits: 'emit()'}]})))
      .toEqual([expect.stringMatching(/^row creature\.died: a local proof needs .* every producer in src\/client \(not src\/shared\/bus\.ts\)$/u)]);
    expect(judge(root, table({}, [{file: 'src/client/hud.ts', name: 'click', why: 'DOM'}]))).toEqual(['ignore src/client/hud.ts click matches nothing: drop it']);
    put('src/client/hud.ts', 'export {};\n');
    expect(judge(root, table())).toEqual(['row creature.died: src/client/hud.ts no longer listens to event creature.died: drop it from the row']);
  });
});
