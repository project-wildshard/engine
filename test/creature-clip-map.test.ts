import { readFileSync } from 'node:fs';
import { Bone, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { Scope } from '../src/shared/engine/app/scope';
import { loadClientSkins, SkinDriver } from '../src/client/game/shardfile/clientSkins';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test.each([
  { mapped: 'swing', x: 2 },
  { mapped: 'missing', x: 0.5 },
  { mapped: undefined, x: 0.5 },
])('real client skin and authoritative collision both select $mapped', async ({ mapped, x }) => {
  const { source, assets } = await creatureVolumeFixture('translation', 2, 0.1, 'hand.R', true);
  const look = source.rows.looks[0], body = source.rows.species[0]?.body;
  if (look === undefined || body === undefined) throw new Error('Missing mapped skin fixture');
  body.size = 'giant'; body.scale = 0.125; body.hits = 'clip';
  if (mapped !== undefined) {
    source.rows = parseRows({ ...source.rows, looks: [
      { ...look, animation: { ...look.animation, clipMap: { states: { attack: mapped } } } },
    ] });
  }

  const scope = new Scope('mapped creature skin');
  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  try {
    const skin = (await loadClientSkins(source, assets, () => new MeshStandardMaterial(), scope)).get(look.id);
    const actor = sim.host.entities.get('fixture.actor');
    if (skin === undefined || actor?.hitVolumes?.joint === undefined) throw new Error('Missing actual skin owners');
    const bones: Record<string, Bone> = {};
    for (const { name, pos } of skin.bones) {
      const bone = new Bone();
      bone.name = name; bone.position.fromArray(pos);
      bones[name] = bone;
    }
    const driver = new SkinDriver(skin, bones);
    driver.step({ dt: 0, t: 0, alive: true, flinch: 0, attack: 0.5, speed: 0, strafe: 0, scale: 1, phase: 0, state: 'attack' });
    expect(bones['hand.R']?.position.x).toBeCloseTo(x);

    actor.startAttack(1);
    for (let tick = 0; tick < 30; tick++) sim.host.step();
    const point = new Vector3();
    expect(actor.hitVolumes.joint('hand.R', point, new Quaternion(), new Vector3())).toBe(true);
    expect(point.x).toBeCloseTo(x);
  } finally {
    scope.dispose();
    sim.dispose();
  }
});
