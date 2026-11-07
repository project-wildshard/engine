import { expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimLevel } from '@wildshard/engine/sim';
import { GridAssembly, type GridPoint } from '../src/shared/game/grid/assembly';
import { LiveGridHost } from '../src/client/game/grid/live';
import { PageResidency } from '../src/client/game/grid/pageResidency';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const level: SimLevel = { version: 3, id: 'platform', seed: 1, ground: { size: 500, height: 0 },
  player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 30 }, entities: [], quests: [],
  weapon: { id: 'none', shape: { kind: 'point', radius: 0 }, windup: 0, active: 0, recover: 0, cooldown: 0, range: 0, damage: 0, tags: [] } };

// Original road selection, retained independently of the host's private ordered cells.
function original(assembly: GridAssembly, feet: GridPoint): string | null {
  const distance = (cell: (typeof assembly.cells)[number]): number => Math.max(Math.abs(feet.x - cell.origin.x), Math.abs(feet.z - cell.origin.z)) - CHUNK_HALF;
  return [...assembly.cells].sort((a, b) => a.instance.localeCompare(b.instance)).find(cell => distance(cell) <= 6)?.instance ?? null;
}

for (const mode of [{ developer: false, devserver: false }, { developer: true, devserver: false },
  { developer: false, devserver: true }, { developer: true, devserver: true }]) {
  test(`road targets retain exact order and boundary decisions ${JSON.stringify(mode)}`, async () => {
    const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
    const assembly = new GridAssembly(mode), cells = assembly.cells, home = assembly.cell('driftwood-isle');
    const page = createSimHost(level, { rapier: R }), residency = new PageResidency();
    const player = { position: leadPlayer(page).position, yaw: 0, health: leadPlayer(page).health, owner: leadPlayer(page), motor: leadPlayer(page).releaseMotor() };
    const live = new LiveGridHost(assembly, {
      home: { mode: 'owned', instance: home.instance, bytes: 1000, residency: residency.admitHome(home.instance, 1000) },
      player, allocator: residency.allocator,
      bindFrame: () => undefined, gameplayReady: () => true,
      highway: { bytes: 1000, create: () => ({ physics: page.physics, dispose: () => undefined }) },
      readiness: { link: { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: .25, maxStallSeconds: 3 },
        bundle: () => ({ criticalWireBytes: 1000, hybridWireBytes: 1000, decodeSeconds: 0, runtimeParseSeconds: 0 }) },
      admit: () => { throw new Error('Target lookup must not admit a region'); },
    });
    try {
      const points: GridPoint[] = [];
      for (const cell of cells) for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
        for (const distance of [0, CHUNK_HALF + 6, CHUNK_HALF + 6.00001, assembly.pitch / 2]) {
          points.push({ ...cell.origin, [axis]: cell.origin[axis] + side * distance });
        }
      }
      const expected = points.map(point => original(assembly, point));
      const compare = vi.spyOn(String.prototype, 'localeCompare');
      try {
        for (const axis of ['x', 'y', 'z'] as const) for (const bad of [Number.NaN, Infinity, -Infinity]) {
          expect(() => live.target({ x: 0, y: 0, z: 0, [axis]: bad })).toThrow('Invalid live grid feet');
        }
        expect(compare).not.toHaveBeenCalled();
        expect(points.map(point => live.target(point))).toEqual(expected);
        expect(compare).toHaveBeenCalled(); compare.mockClear();
        expect([...points].reverse().map(point => live.target(point))).toEqual([...expected].reverse());
        expect(compare).not.toHaveBeenCalled();
        expect(assembly.cells).toBe(cells); expect(Object.isFrozen(cells)).toBe(true);
      } finally { compare.mockRestore(); }
    } finally { live.dispose(); player.motor.dispose(); page.dispose(); residency.dispose(); }
  });
}
