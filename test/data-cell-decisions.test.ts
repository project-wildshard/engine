// oxlint-disable-next-line import/no-nodejs-modules -- The real cell runs the shipped Rapier bytes and TE-ENG1's compiled fixture modules.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { parseActorMoves } from '@wildshard/format/actorMoves';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// MH-4 (opus-mh4b): a page's standalone server and a room open a data shard through `openCellWorld`. Its decisions ride
// the product's sections; a cell opened without them ran no decision, so a rows-only boss (TE-ENG1) fell back to the
// encounter's native chase in every browser while the sim test passed. The cell must hand the sections to the sim.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const fixtureBytes = (name: string): Uint8Array => Uint8Array.from(readFileSync(`test/fixtures/boss-tell/${name}.wasm`));
function warden() {
  const source = emptyShardfile({ slug: 'boss-cell', name: 'Boss cell', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'warden', kind: 'boar', label: 'Warden', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'warden', label: 'Warden', rarity: 'common', weight: 1, scale: [1, 1], hp: 400, mods: structuredClone(native.spec.mods) }] }];
  source.rows.strikes = [{ id: 'slam', shape: { kind: 'sphere', radius: 3 }, windup: 0.6, active: 0.1, recover: 0.2, cooldown: 0.5, range: 30, damage: 1, tags: ['dmg.melee'], weight: 1, speed: 0 }];
  source.creatures.spawns = [{ id: 'warden', species: 'warden', variant: 'warden', brain: null, strike: null, seed: 1, scale: 1, at: [0, 0, 6], yaw: 0 }];
  source.encounters = [{ id: 'warden.fight', entity: 'warden', kind: 'boss', panel: null, name: 'Warden', title: 'Test', retry: 'Retry', arena: { at: [0, 0, 6], radius: 30 },
    intro: 0, introShort: 0, respawn: { at: [0, 0, 0], yaw: 0 }, phases: [{ at: 1, name: 'Fight', caption: 'Fight', speed: 0, stopDistance: 0, turnRate: 2 }] }];
  source.state.shared = [{ id: 110, name: 'warden.tell', type: 'bool', privacy: 'public', default: 0, min: 0, max: 1 },
    { id: 111, name: 'warden.open', type: 'bool', privacy: 'public', default: 0, min: 0, max: 1 }];
  const scene = fixtureBytes('scene'), sceneHash = hashImmutableBytes(scene), decision = fixtureBytes('decision-melee'), hash = hashImmutableBytes(decision);
  source.sim.scripts = [sceneHash]; source.sim.bindings = [{ module: sceneHash, entity: 1, actorId: null, kind: 'server' }];
  const scripts = parseDecisionScripts([{ id: 'warden.decision', abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: 'behaviour/warden.as',
    binding: { encounter: 'warden.fight' }, onFail: 'hold', on: ['start', 'player.join', 'timer', 'strike.done', 'stop'], reads: [], commands: ['strike', 'field', 'timer', 'encounter'],
    stateVersion: 1, state: [{ name: 'step', type: 'i32', default: 0, scope: 'binding' }], params: {}, timers: ['window'],
    actors: { boss: 'warden' }, strikes: { slam: 'slam' }, fields: { tell: 'warden.tell', open: 'warden.open' } }]);
  const sections = new Map<string, unknown>([['sim/scripts', scripts], ['actors/moves', parseActorMoves([])]]);
  return { shard: source, assets: new Map([[sceneHash, scene], [hash, decision]]), sections };
}

test('a data cell runs its decisions: the rows-only boss winds up its slam', async () => {
  const f = warden();
  const cell = await openCellWorld({ instance: 'boss-cell' }, { shard: f.shard, assets: f.assets, sections: f.sections, rapier: await rapier } as never,
    undefined, { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true });
  try {
    let wound = false;
    for (let i = 0; i < 600 && !wound; i++) { cell.step([]); wound = cell.host.strikes.get('warden')?.state === 'windup'; }
    expect(wound).toBe(true);
  } finally { cell.dispose(); }
});
