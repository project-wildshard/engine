import { expect, test } from 'vitest';
import * as THREE from 'three';
import { ARENA_LINEUP } from '../src/client/engine/practice/lineup';
import { enterPracticeLoan, exitPracticeLoan, practiceViewDistance, type PracticeLoanPorts } from '../src/client/engine/practice/practiceLoan';

/** TrainingArena.viewDistance as it was inline before the extraction (verbatim, the camera and innerWidth as arguments) */
function inline(fov: number, aspect: number, innerWidth: number): number {
  const half = innerWidth / 2;
  const usable = Math.max(0.5, (half - 10) / half);
  const tanH = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect * usable;
  const centre = ARENA_LINEUP[1] ?? { x: 0, z: -7 };
  let need = 4.8;
  for (const spot of ARENA_LINEUP) {
    const reach = Math.abs(spot.x) + 0.5;
    need = Math.max(need, reach / Math.max(0.15, tanH) - (centre.z - spot.z));
  }
  return Math.min(11, need);
}

test('the spawn distance is the page frame fit, exactly', () => {
  let seed = 4;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const [fov, aspect, width] of [[72, 402 / 874, 402], [93, 402 / 874, 402], [75, 16 / 9, 1280], [60, 1, 15]] as const)
    expect(practiceViewDistance(fov, aspect, width)).toBe(inline(fov, aspect, width));
  for (let i = 0; i < 500; i++) {
    const fov = 30 + rnd() * 90, aspect = .3 + rnd() * 2.5, width = 10 + rnd() * 2600;
    expect(practiceViewDistance(fov, aspect, width)).toBe(inline(fov, aspect, width));
  }
});

test('entry lends every weapon, selects the first, steps off the board and spawns looking down; exit ends the loan', () => {
  const log: string[] = [];
  const ports = (ids: readonly string[]): PracticeLoanPorts<string> => ({
    weapons: { list: ids.map(id => ({ id })), current: { id: 'held' },
      lendAll: () => { log.push('lendAll'); }, select: (id, instant) => { log.push(`select ${id} ${String(instant)}`); } },
    player: { pitch: 0, setHover: on => { log.push(`hover ${String(on)}`); }, spawn: (x, z, yaw, y) => { log.push(`spawn ${[x, z, yaw, y].join(',')}`); } },
  });
  const room = ports(['bow', 'spear']);
  enterPracticeLoan(room, { x: 3, z: -1.5, y: 900 });
  expect(log).toEqual(['lendAll', 'select bow true', 'hover false', 'spawn 3,-1.5,0,900']);
  expect(room.player.pitch).toBe(-0.1);
  log.length = 0; enterPracticeLoan(ports([]), { x: 0, z: 0, y: 900 }); // an empty kit keeps what is held
  expect(log[1]).toBe('select held true');
  let ended = 0;
  exitPracticeLoan({ endLoan: () => { ended++; } }); exitPracticeLoan(null);
  expect(ended).toBe(1);
});
