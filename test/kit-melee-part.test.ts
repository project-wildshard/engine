import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

// ONE-FORMAT OF25c: a shard's kit melee blow names the authored part it meets, so it wears that part's hp. Before, a kit
// sword (`ItemRuntime.strike`) hit the body's middle with no part, and the stranger shard's mech plate (CC36) never broke:
// only the native blade and the lever named a part.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const sword = { id: 'kit.sword', kind: 'weapon', family: 'kit.melee', charge: 1,
  light: { id: 'light', damage: 10, cooldown: 0.5, range: 2.2, width: 0.6, tags: [], effect: null },
  heavy: { id: 'heavy', damage: 20, cooldown: 1, range: 2.2, width: 0.6, tags: [], effect: null } };

test('a kit sword swung at a mech plate wears its hp and breaks it', async () => {
  const fixture = await creatureVolumeFixture(), species = fixture.source.rows.species[0];
  if (species?.body === undefined) throw new Error('Missing plated fixture');
  species.body = { ...species.body, channels: [{ name: 'plate' }],
    volumes: [{ part: 'plate', bone: 'hand.L', shape: 'sphere', radius: .4, halfLength: 0, axis: 'y', multiplier: 0, hp: 30, channel: 'plate' }] };
  const sim = createShardfileSim(fixture.source, fixture.assets, { rapier: await rapier });
  try {
    const host = sim.host, mech = host.entities.get('fixture.actor'), player = host.players.get('actor.player');
    const shard = { items: { rows: [sword], loadout: { primary: sword.id, secondary: null, extras: [], tools: [] } },
      targets: { interactions: [], itemActions: [] }, state: { player: [] } } as unknown as Parameters<typeof installDeclaredKitItems>[1];
    const kit = installDeclaredKitItems(host, shard, () => new Map());
    if (mech === undefined || player === undefined || kit === null || mech.hitVolumes === undefined) throw new Error('A plated mech, a player and a kit sword');
    const broken: string[] = [], parts: (string | undefined)[] = [];
    host.events.on('creature.part-broken', ({ part }) => { broken.push(part); }, host.scope);
    host.events.on('damage.dealt', ({ req }) => { if (req.weaponId === sword.id) parts.push(req.part); }, host.scope);
    host.step();
    const plate = new Vector3(), front = new Vector3(), at = mech.hitVolumes.volumes.findIndex(row => row.part === 'plate');
    mech.hitVolumes.segment(at, plate, front);
    // stand a metre out past the plate, on the line through the mech's middle, and swing at the plate
    const out = new Vector3(plate.x - mech.position.x, 0, plate.z - mech.position.z).normalize();
    const x = plate.x + out.x, z = plate.z + out.z;
    for (let swing = 1; swing <= 4; swing++) {
      player.position.set(x, host.groundHeightAt(x, z) + 0.05, z); player.motor.resetAt(player.position);
      const eye = { x, y: player.position.y + 1.68, z }, to = new Vector3(plate.x - eye.x, plate.y - eye.y, plate.z - eye.z).normalize();
      player.yaw = Math.atan2(-to.x, -to.z);
      kit.command('actor.player', { seq: swing, buttons: 0, pitch: Math.asin(to.y), attack: { aim: { origin: eye, direction: { x: to.x, y: to.y, z: to.z } } } } as Parameters<typeof kit.command>[1]);
      for (let tick = 0; tick < 40; tick++) host.step();
    }
    // three 10-point blows wear the 30-hp plate to 0 and deal nothing (it is x0); it breaks once and its channel reads 1.
    // The fourth passes through the broken plate to the body behind it.
    expect(broken).toEqual(['plate']);
    expect(parts).toEqual(['body']);
    expect(mech.channels[0]).toBe(1);
  } finally { sim.dispose(); }
});
