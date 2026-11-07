// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Read the actual Inspector expressions without starting a Simulator.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the tool's browser transition with deterministic Inspector ports.
import {runInNewContext} from 'node:vm';
import {afterEach, expect, test} from 'vitest';
import {HUD} from '../src/client/engine/ui/HUD';

const source = readFileSync('scripts/sim-memory.mjs', 'utf8');
function transitionSource(): string {
  const identityStart = source.indexOf('    const identity = async () =>');
  const identityEnd = source.indexOf('    result.identity = await checkIdentity();', identityStart);
  const start = source.indexOf("    setPhase('menu');");
  const end = source.indexOf('    const key = (type, code) =>', start);
  if (identityStart === -1 || identityEnd < identityStart || start === -1 || end < start) throw new Error('Missing maintained Inspector transition');
  return `(async () => {${source.slice(identityStart, identityEnd)}\n${source.slice(start, end)}})`;
}
afterEach(() => {document.body.replaceChildren();});

function fixture(shard: string, options: {showHub?: boolean; initial?: string; changeOnWorld?: boolean} = {}) {
  let actual = options.initial ?? shard, exits = 0, defaultExplores = 0, ownExplores = 0, worldClicks = 0;
  const root = document.createElement('div');
  root.innerHTML = '<button class="ws-gmenu-exit">Exit to main</button><button class="ws-menu-explore">Explore default card</button>';
  document.body.append(root);
  const addWorldCard = (): void => {
    const card = document.createElement('button'); card.className = 'ws-x-card'; card.dataset['m'] = 'world';
    card.addEventListener('click', () => {worldClicks++; if (options.changeOnWorld === true) actual = 'driftwood-isle';});
    root.append(card);
  };
  root.querySelector('.ws-gmenu-exit')?.addEventListener('click', () => {exits++; actual = 'driftwood-isle';});
  root.querySelector('.ws-menu-explore')?.addEventListener('click', () => {defaultExplores++; actual = 'driftwood-isle'; addWorldCard();});
  const start: unknown = Reflect.get(HUD.prototype, 'startExplore');
  if (typeof start !== 'function') throw new Error('Missing public HUD Explorer entry');
  const hud = {root, intro: undefined,
    onExplore: () => {ownExplores++; if (options.showHub !== false) addWorldCard();},
    startExplore() {Reflect.apply(start, this, []);}};
  const world = {game: {level: {get id() {return actual;}}}, hud};
  const browser = {window: {__wildshard: {boot: {build: 'fixture-build'}, world}}, document, Event};
  const result: {explorerEntryIdentity?: unknown} = {}, phases: string[] = [], sleeps: number[] = [];
  const evaluate = (expression: string): Promise<unknown> => {
    const value: unknown = runInNewContext(expression, browser); return Promise.resolve(value);
  };
  const run = async (): Promise<void> => {
    const body: unknown = runInNewContext(transitionSource(), {
      evaluate, run: {shard}, opts: {expectedBuild: 'fixture-build'}, result,
      setPhase: (phase: string) => {phases.push(phase);}, sleep: (ms: number) => {sleeps.push(ms); return Promise.resolve();},
    });
    if (typeof body !== 'function') throw new Error('Inspector transition is not callable');
    const pending: unknown = Reflect.apply(body, undefined, []); await pending;
  };
  return {run, result, phases, sleeps, world, status: () => ({actual, exits, defaultExplores, ownExplores, worldClicks})};
}

test.each(['pine-hollow', 'driftwood-isle', '_template'])('Explorer stays in the measured %s runtime through its real HUD entry', async shard => {
  const f = fixture(shard);
  await f.run();
  expect(f.status()).toEqual({actual: shard, exits: 0, defaultExplores: 0, ownExplores: 1, worldClicks: 1});
  expect(f.result.explorerEntryIdentity).toEqual({build: 'fixture-build', shard});
  expect(f.world.game.level.id).toBe(shard);
  expect(f.phases).toEqual(['menu', 'explorer']);
});

test('a wrong starting runtime retains the original identity refusal before Explorer starts', async () => {
  const f = fixture('pine-hollow', {initial: 'driftwood-isle'});
  await expect(f.run()).rejects.toThrow('wrong runtime: expected fixture-build/pine-hollow');
  expect(f.status()).toMatchObject({exits: 0, defaultExplores: 0, ownExplores: 0, worldClicks: 0});
  expect(f.result.explorerEntryIdentity).toBeUndefined();
});

test('a runtime change at the world card refuses before any flight sampling', async () => {
  const f = fixture('pine-hollow', {changeOnWorld: true});
  await expect(f.run()).rejects.toThrow('wrong runtime: expected fixture-build/pine-hollow');
  expect(f.status()).toMatchObject({ownExplores: 1, worldClicks: 1});
  expect(f.result.explorerEntryIdentity).toBeUndefined();
});

test('a missing Explore hub keeps the original bounded refusal instead of using the default card', async () => {
  const f = fixture('pine-hollow', {showHub: false});
  await expect(f.run()).rejects.toThrow('the Explore hub never showed');
  expect(f.sleeps.filter(ms => ms === 500)).toHaveLength(60);
  expect(f.status()).toMatchObject({exits: 0, defaultExplores: 0, ownExplores: 1, worldClicks: 0});
});
