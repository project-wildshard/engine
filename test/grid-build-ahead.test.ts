// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real regional physics and traveller transfer.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimLevel } from '@wildshard/engine/sim';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { LiveGridHost } from '../src/client/game/grid/live';
import { PageResidency } from '../src/client/game/grid/pageResidency';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const level: SimLevel = { version: 3, id: 'platform', seed: 1, ground: { size: 500, height: 0 },
  player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 30 }, entities: [], quests: [],
  weapon: { id: 'none', shape: { kind: 'point', radius: 0 }, windup: 0, active: 0, recover: 0, cooldown: 0, range: 0, damage: 0, tags: [] } };

for (const [axis, side] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]] as const) {
  test(`build ${axis} ${side} destination only on actual entry demand`, async () => {
    const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
    const assembly = new GridAssembly({ developer: false, devserver: false });
    const home = assembly.cell('driftwood-isle');
    const target = assembly.cells.find(cell => cell.origin[axis] === side * assembly.pitch
      && cell.origin[axis === 'x' ? 'z' : 'x'] === 0);
    if (target === undefined) throw new Error('Missing cardinal destination');
    const page = createSimHost(level, { rapier }), residency = new PageResidency();
    const player = { position: leadPlayer(page).position, yaw: 0, health: leadPlayer(page).health, owner: leadPlayer(page), motor: leadPlayer(page).releaseMotor() };
    const created: string[] = [];
    const live = new LiveGridHost(assembly, {
      home: { mode: 'owned', instance: home.instance, bytes: 1000, residency: residency.admitHome(home.instance, 1000) },
      player, allocator: residency.allocator,
      bindFrame: () => undefined, gameplayReady: () => true,
      highway: { bytes: 1000, create: () => ({ physics: page.physics, dispose: () => undefined }) },
      prefetchable: cell => cell.instance === target.instance,
      readiness: { link: { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: 0.25, maxStallSeconds: 3 },
        bundle: () => ({ criticalWireBytes: 1000, hybridWireBytes: 1000, decodeSeconds: 0, runtimeParseSeconds: 0 }) },
      admit: cell => Promise.resolve({ bytes: 1000, exclusiveRuntime: true, prepareRuntime: () => Promise.resolve(),
        create: () => {
          created.push(cell.instance);
          const host = createSimHost(level, { rapier, playerBody: false, ground: false });
          return Promise.resolve({ host, dispose: () => { host.dispose(); } });
        } }),
    });
    try {
      const enterHome = await live.prepare(null, home.instance); enterHome.commit();
      player.position[axis] = side * (CHUNK_HALF - 0.5);
      live.beforeFixed(); await live.prefetch([target.instance]);
      // Products may prefetch inside the source; no second world is constructed.
      expect(created).toEqual([home.instance]); expect(live.state().pending).toEqual([]);
      const leave = await live.prepare(home.instance, null); leave.commit();
      expect(live.unload(home.instance)).toBe(true);
      player.position[axis] = side * (CHUNK_HALF + 0.5);
      live.beforeFixed();
      // Proximity admits immutable metadata; only real entry constructs a world.
      expect(created).toEqual([home.instance]);
      expect(live.state().pending).toEqual([]);
      expect(live.ready(target.instance)).toBe(false);
      const enter = await live.prepare(null, target.instance); enter.commit();
      expect(created).toEqual([home.instance, target.instance]);
      expect(live.state().issues).toEqual({});
    } finally { live.dispose(); player.motor.dispose(); page.dispose(); residency.dispose(); }
    expect(residency.allocator.entries()).toEqual([]);
  });
}
