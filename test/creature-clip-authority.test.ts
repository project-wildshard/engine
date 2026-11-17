import { readFileSync } from 'node:fs';
import { Bone, BoxGeometry, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { nativeRangedHit } from '../src/server/game/plugin/nativeItems';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { keepHitHistory } from '../src/server/engine/net/hitHistory';
import { seenBodies, seenRay } from '../src/server/game/plugin/nativeRewind';
import { CreatureBodies, type Creature } from '../src/shared/engine/physics/creatures';
import { skinSpeciesLook, type ClientSkin } from '../src/client/game/shardfile/clientSkins';
import type { RigAnimCtx } from '../src/shared/engine/entities/species/registry';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import { legacyDouble } from '../src/test/engine/FakeGame';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
async function fixture(path: 'translation' | 'rotation' | 'scale' = 'translation', clip = true) {
  const f = await creatureVolumeFixture(path), body = f.source.rows.species[0]?.body;
  if (body === undefined) throw new Error('Missing clip body'); body.size = 'giant'; body.scale = .25; body.hits = clip ? 'clip' : 'rest';
  const sim = createShardfileSim(f.source, f.assets, { rapier: await rapier }), actor = sim.host.entities.get('fixture.actor');
  if (actor?.hitVolumes === undefined) { sim.dispose(); throw new Error('Missing clip authority'); }
  return { ...f, sim, actor, pose: actor.hitVolumes };
}
test('only giant clip opt-in moves the actual hit ray with the animated head', async () => {
  const clip = await fixture(), rest = await fixture('translation', false);
  try {
    for (let tick = 0; tick < 30; tick++) { clip.sim.host.step(); rest.sim.host.step(); }
    expect(nativeRangedHit([clip.actor], new Vector3(.5, 2, 0), new Vector3(0, 0, 1), 20)?.part).toBe('head');
    expect(nativeRangedHit([clip.actor], new Vector3(0, 2, 0), new Vector3(0, 0, 1), 20)).toBeNull();
    expect(nativeRangedHit([rest.actor], new Vector3(0, 2, 0), new Vector3(0, 0, 1), 20)?.part).toBe('head');
    expect(rest.pose.joint).toBeUndefined(); expect(rest.pose.capture).toBeUndefined();
    const before = snapshotSimHost(clip.sim.host);
    for (let read = 0; read < 100; read++) nativeRangedHit([clip.actor], new Vector3(.5, 2, 0), new Vector3(0, 0, 1), 20);
    expect(snapshotSimHost(clip.sim.host)).toEqual(before);
  } finally { clip.sim.dispose(); rest.sim.dispose(); }
});
test('clip authority restores from existing actor/host time without a second playback clock', async () => {
  const f = await fixture(), resumed = prepareShardfileSimRestore(f.source, f.assets, { rapier: await rapier });
  try {
    for (let tick = 0; tick < 23; tick++) f.sim.host.step(); resumed.restore(snapshotSimHost(f.sim.host));
    const actor = resumed.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing resumed giant');
    for (let tick = 0; tick < 35; tick++) {
      f.sim.host.step(); resumed.host.step();
      const a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3();
      f.pose.segment(1, a, b); actor.hitVolumes?.segment(1, c, d); expect(c.toArray()).toEqual(a.toArray()); expect(d.toArray()).toEqual(b.toArray());
    }
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(f.sim.host));
  } finally { f.sim.dispose(); resumed.host.dispose(); }
});
test('rewind reads the recorded clip head rather than its present bone pose', async () => {
  const f = await fixture();
  try {
    const history = keepHitHistory(f.sim.host);
    for (let tick = 0; tick < 30; tick++) f.sim.host.step();
    for (let tick = 0; tick < 12; tick++) f.sim.host.step();
    const past = seenBodies(f.sim.host, 30); if (past === null) throw new Error('Missing giant history');
    const a = new Vector3(), b = new Vector3(); past[0]?.hitVolumes?.segment(1, a, b);
    expect(a.x).toBeCloseTo(.5, 5); f.pose.segment(1, a, b); expect(a.x).toBeCloseTo(.7, 5);
    expect(seenRay(past, new Vector3(.21, 2, 0), new Vector3(0, 0, 1), 20)?.part).toBe('head');
    expect(nativeRangedHit([f.actor], new Vector3(.21, 2, 0), new Vector3(0, 0, 1), 20)).toBeNull();
    expect(history.bytes).toBeGreaterThan(208);
  } finally { f.sim.dispose(); }
});
test('actual Rapier hitbox dimensions follow sampled scale and retain minimum radius', async () => {
  const f = await fixture('scale'), bodies = new CreatureBodies(f.sim.host.physics);
  const proxy: Creature = { position: f.actor.position, alive: true, hidden: false, scale: 1, dims: f.actor.dims,
    hitVolumes: f.pose, motor: null, driven: false, simulationBound: true,
    headWorld: out => f.actor.headWorld(out), bodyCapsule: (a, b) => f.actor.bodyCapsule(a, b) };
  try {
    bodies.sync([proxy], new Vector3());
    for (let tick = 0; tick < 30; tick++) f.sim.host.step(); bodies.sync([proxy], new Vector3()); f.sim.host.physics.world.step();
    expect(f.pose.volumes[1]?.radius).toBeCloseTo(.45, 6);
    expect(bodies.cast(new Vector3(.4, 2, 0), new Vector3(0, 0, 1), 20)?.part).toBe('head');
  } finally { bodies.remove(proxy); f.sim.dispose(); }
});
test('the actual skin animation borrows the same authoritative sampled local joints', async () => {
  const f = await fixture(), geometry = new BoxGeometry();
  try {
    for (let tick = 0; tick < 30; tick++) f.sim.host.step();
    const species = f.source.rows.species[0], look = f.source.rows.looks[0]; if (species === undefined || look === undefined) throw new Error('Missing skin rows');
    const skin: ClientSkin = { id: 'fixture.skin', geometry, bones: [], material: () => new MeshLambertMaterial(), parts: [], clips: new Map(), skeleton: 'fixture.biped', sockets: [], attackSpan: 1 };
    const bones = Object.fromEntries(['body', 'chest', 'head', 'hand.L'].map(name => [name, new Bone()]));
    skinSpeciesLook(look, species, skin).animate?.(legacyDouble<RigAnimCtx>({ bones, animal: legacyDouble<Animal>({ hitVolumes: f.pose }) }));
    const p = new Vector3(), q = new Quaternion(), s = new Vector3(); expect(f.pose.joint?.('head', p, q, s)).toBe(true);
    expect(bones['head']?.position.toArray()).toEqual(p.toArray()); expect(p.toArray()).toEqual([.5, 1, 0]);
  } finally { geometry.dispose(); f.sim.dispose(); }
});
