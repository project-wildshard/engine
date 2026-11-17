// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from '../src/test/game/builtProduct';

// TEMPLATE-E2E TC-SHIP-e2: a kit melee blow reaches a body's surface, not only its middle. The Template's Barrow Warden is a
// scale-3 body 2.25 m round, so a player who runs into it stops about 2.5 m from its middle; the iron sword's 2.2 m range
// was measured to that middle, and on staging no swing a player could make ever landed (the sharddev test that passed put
// the player 1.8 m away, inside the body). Here the player runs into the Warden and swings from where it stops.
test('the iron sword lands on the Barrow Warden from where a player who runs into it stops', async () => {
  const directory = builtProduct('_template'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const shard = product.shardfile;
  const server = descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(shard, assets, { rapier, quest: { fact: () => undefined, coins: () => undefined } });
  try {
    const host = sim.host, player = host.players.get('actor.player'), warden = host.entities.get('barrow-warden');
    const kit = installDeclaredKitItems(host, shard, sim.itemHooks), rack = shard.targets.interactions.find(row => row.id === 'template.rack.use');
    if (player === undefined || warden === undefined || kit === null || rack === undefined) throw new Error('The Template has a player, the Warden, its kit and the rack');
    const put = (x: number, z: number): void => { player.position.set(x, host.groundHeightAt(x, z) + 0.05, z); player.motor.resetAt(player.position); };
    put(rack.at[0], rack.at[2]); host.step();
    expect(kit.scene('actor.player', rack.id)).toBe(true);
    host.step();
    // run at the Warden from 5 m out until the body stops the player
    put(warden.position.x - 5, warden.position.z);
    for (let i = 0; i < 30; i++) host.step();
    for (let dash = 0; dash < 3; dash++) { player.dashTo(warden.position.x, warden.position.z, 0, 1.2); for (let i = 0; i < 90; i++) host.step(); }
    const stood = { x: player.position.x, z: player.position.z }, gap = Math.hypot(stood.x - warden.position.x, stood.z - warden.position.z);
    expect(gap).toBeGreaterThan(2.2);
    const full = player.health.attributes.health;
    let landed = 0, swings = 0;
    host.events.on('damage.dealt', ({ req }) => { if (req.target === warden.combatActor() && req.weaponId === 'weapon.sword-iron') landed++; }, host.scope);
    for (let tick = 0; tick < 180 * 60 && warden.alive; tick++) {
      // kept whole and where it stopped: this proves the reach, not the fight's balance
      player.health.attributes.health = full; put(stood.x, stood.z);
      if (tick % 30 === 0) {
        const eye = { x: stood.x, y: player.position.y + 1.68, z: stood.z }, to = { x: warden.position.x - eye.x, y: warden.position.y + 2.55 - eye.y, z: warden.position.z - eye.z };
        const length = Math.hypot(to.x, to.y, to.z), direction = { x: to.x / length, y: to.y / length, z: to.z / length };
        player.yaw = Math.atan2(-to.x, -to.z); swings++;
        kit.command('actor.player', { seq: swings, buttons: 0, pitch: Math.asin(direction.y), attack: { aim: { origin: eye, direction } } } as Parameters<typeof kit.command>[1]);
      }
      host.step();
    }
    expect({ landed: landed > 0, alive: warden.alive }).toEqual({ landed: true, alive: false });
  } finally { sim.dispose(); }
});
