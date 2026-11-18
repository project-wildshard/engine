import { expect, test } from 'vitest';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimLevel } from '@wildshard/engine/sim';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { LiveGridHost } from '../src/client/game/grid/live';
import { PageResidency } from '../src/client/game/grid/pageResidency';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const level: SimLevel = { version: 3, id: 'platform', seed: 1, ground: { size: 500, height: 0 },
  player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 30 }, entities: [], quests: [],
  weapon: { id: 'none', shape: { kind: 'point', radius: 0 }, windup: 0, active: 0, recover: 0, cooldown: 0, range: 0, damage: 0, tags: [] } };

test('the only page path targets the home cell or the road', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
  const assembly = new GridAssembly({ developer: false, devserver: false }), home = assembly.cell('driftwood-isle');
  const page = createSimHost(level, { rapier: R }), residency = new PageResidency();
  const player = { position: leadPlayer(page).position, yaw: 0, health: leadPlayer(page).health, owner: leadPlayer(page), motor: leadPlayer(page).releaseMotor() };
  const reads: string[] = [];
  const expiry: { run: () => void }[] = [];
  const live = new LiveGridHost(assembly, {
    home: { mode: 'owned', instance: home.instance, bytes: 1000, residency: residency.admitHome(home.instance, 1000) }, player, allocator: residency.allocator,
    bindFrame: () => undefined, gameplayReady: () => true,
    lastCell: { windowMs: 30_000, playingBytes: 2_000_000_000, schedule: run => { expiry.push({ run }); return () => undefined; } },
    highway: { bytes: 1000, create: () => ({ physics: page.physics, dispose: () => undefined }) },
    readiness: { link: { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: .25, maxStallSeconds: 3 }, bundle: () => ({ criticalWireBytes: 1000, runtimePageWireBytes: 1000, decodeSeconds: 0, runtimeParseSeconds: 0 }) },
    admit: async cell => {
      if (cell.instance !== home.instance) { reads.push(cell.instance); throw new Error('gate must not admit another cell'); }
      return { bytes: 1000, exclusiveRuntime: true, isolatedPreparation: true, prepareRuntime: () => Promise.resolve(), create: () => Promise.resolve({ host: page, dispose: () => undefined }) };
    },
  });
  try {
    const other = assembly.cells.find(cell => cell.instance !== home.instance);
    if (other === undefined) throw new Error('fixture needs a second cell');
    expect(live.target({ ...home.origin, y: 0 })).toBe(home.instance);
    expect(live.target({ ...other.origin, y: 0 })).toBeNull();
    (await live.prepare(null, home.instance)).commit();
    player.position.x = 281.25; player.position.z = 281.25;
    (await live.prepare(home.instance, null)).commit();
    expect(live.retainDeparted(home.instance)).toBe(true);
    for (const point of [{ x: 281.25, z: 281.25 }, { x: 843.75, z: 281.25 }, { x: 843.75, z: -281.25 }, { x: 281.25, z: -281.25 }]) {
      player.position.x = point.x; player.position.z = point.z; live.beforeFixed();
    }
    expect(reads).toEqual([]);
    expect(live.state().residents).toEqual([home.instance]);
    expect(expiry).toHaveLength(1);
  } finally { live.dispose(); player.motor.dispose(); page.dispose(); residency.dispose(); }
});
