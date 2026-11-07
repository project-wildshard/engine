import {admissionNative} from './fixtures/nalati-return-modules';

// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual native simulation owners.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { installNativeGroupRows, nativeGroupCollection, nativeHerdCollection } from '../src/server/game/shardfile/groupRuntime';
import { NativeWildEnvironment } from '../src/server/game/population/nativeManager';
import { GrassField } from '../src/shared/game/systems/looks/grassField';
import { TrampleField } from '../src/shared/game/systems/looks/trampleField';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const pack = { id: 'orchard.boars', kind: 'pack', members: ['orchard.scout'], home: [3,4], thinkDivisor: 6,
  trotSpeed: 2, runSpeed: 7, shadowMinRadius: 10, shadowMaxRadius: 20, ringMinRadius: 6, ringMaxRadius: 9,
  biteRadius: 1, sightRadius: 20, coneAngle: 1, smellRadius: 25, hearing: [1,3,6,12], telegraphSeconds: .3,
  dashSeconds: 1, breakoffSeconds: 1, attackSeconds: .5, leaderVariant: 'elder', yipCue: 'grunt', howlCue: 'grunt', snarlCue: 'grunt', biteCue: 'grunt' };
const herd = { id: 'orchard.goats', kind: 'herd', members: ['orchard.kid'], thinkDivisor: 6,
  walkSpeed: 1, trotSpeed: 3, gallopSpeed: 7, chargeSpeed: 6, sightRadius: 30, grazingSightRadius: 12,
  coneAngle: 1, hearing: [1,2,4,8], alertThreshold: .4, flightMinDistance: 20, flightMaxDistance: 35,
  stallionVariant: 'buck', foalPrefix: 'kid', snortCue: 'bleat', neighCue: 'bleat', squealCue: 'bleat' };
const strike = { id: 'orchard.contact', shape: { kind: 'point', radius: 1, exclusive: true }, windup: 0, active: 0, recover: 0,
  cooldown: 0, range: null, damage: 1, tags: [], weight: { kind: 'constant', value: 1 } };
const rows = { id: 'orchard.groups', herds: 'orchard.herds', tokens: 'orchard.tokens', bounds: [-16,16,-16,16], owned: ['orchard.buck'],
  contacts: { pack: strike, herd: strike }, steps: [{ kind: 'group', row: pack, adopt: null }, { kind: 'group', row: herd, adopt: 'orchard.buck' }] };

test('orchard rows bind native senses, prey, adopted herd and deferred pack identities', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native actor');
  const entities = [];
  for (const [index,name] of ['scout','kid','buck'].entries()) entities.push({ ...sample, id: `orchard.${name}`, seed: index+1,
    at: { x: index+3,y: 0,z: 4 }, spec: { ...sample.spec, kind: name === 'scout' ? 'boar' : 'goat', variant: name } });
  const host = createSimHost({ ...SIM_LEVEL, entities, quests: [] }, { rapier });
  const field = new GrassField({ seed: 19, half: 16, heightAt: () => 0, normalAt: () => [0,1,0], splatAt: () => [1,0,0,0],
    trailDistance: () => Infinity, cabinMask: () => 0, pondMask: () => 0, waterLevel: () => -100, paint: () => false, layout: null });
  const env = new NativeWildEnvironment(field,new TrampleField(),{ wind: { x: 1,z: 0,strength: .5 }, flatten: .85 },admissionNative(host));
  const grid = { res: 2,size: 32,seed: 19,landscapeHash: 0,heights: new Float32Array(4),splat: new Uint8Array(16),undergrowth: null };
  try {
    const before = host.rng.snapshot();
    expect(() => installNativeGroupRows(host,{ ...rows, owned: ['orchard.missing'] },grid,env)).toThrow('Missing group actor');
    expect(host.rng.snapshot()).toEqual(before); expect(host.entities.get('orchard.buck')?.mem['owned']).toBeUndefined();
    const owner = installNativeGroupRows(host,rows,grid,env), kid = host.entities.get('orchard.kid'), buck = host.entities.get('orchard.buck');
    expect(nativeGroupCollection(host,rows.id)).toBe(owner); expect(owner.owns(host)).toBe(true); expect(owner.tokens?.id).toBe(rows.tokens);
    const admitted = nativeHerdCollection(host,rows.herds);
    expect(admitted).toBe(owner); expect(nativeHerdCollection(host,rows.herds)).toBe(admitted);
    expect(admitted.herds).toBe(owner.herds); expect(admitted.wind).toBe(env.wind);
    env.wind.strength = .75; expect(admitted.wind.strength).toBe(.75);
    expect(owner.herds[0]?.stallion).toBe(buck); expect(buck?.mem['owned']).toBe(1);
    expect(owner.packs[0]?.findPrey?.(3,4,10)).toBe(kid); expect(owner.herds[0]?.findThreat?.(3,4,10)?.entityId).toBe('orchard.scout');
    const point = new Vector3(), visible = env.visibility(8,0,point,1,10);
    env.playerCrouched = true; expect(env.visibility(8,0,point,1,10)).toBeLessThan(visible);
    const audible = env.hearing([1,2,4,8],point,3); env.storm = true; expect(env.hearing([1,2,4,8],point,3)).toBe(audible/2);
    expect(env.downwind(5,0,point)).toBe(true); expect(env.downwind(-5,0,point)).toBe(false);
    const next = host.spawn({ ...sample, id: 'orchard.return', spec: { ...sample.spec, variant: 'elder' } });
    const packOwner = owner.addPack([next],1,2); expect(packOwner.findPrey?.(3,4,10)).toBe(kid);
    expect(() => installNativeGroupRows(host,rows,grid,env)).toThrow('installed');
  } finally { host.dispose(); }
  expect(() => nativeHerdCollection(host,rows.herds)).toThrow('Missing native herd collection');
});
