import type { Physics } from '../../../shared/engine/physics/Physics';
import { CharacterMotor } from '../../../shared/engine/physics/CharacterMotor';
import { ENTRY_WIDTH } from '../../../shared/engine/core/config';

/** Real capsule walks cover every legal 8 m entry for 50 m, at overlapping lateral intervals. */
export function walkEdgeEntries(physics: Physics, waterAt: (x: number, z: number) => number | null = () => null,
  sides: readonly ('north' | 'east' | 'south' | 'west')[] = ['north', 'east', 'south', 'west']): { lanes: number; steps: number } {
  if (new Set(sides).size !== sides.length || sides.some(side => !['north', 'east', 'south', 'west'].includes(side))) throw new Error('Invalid edge proof selection');
  const motor = new CharacterMotor(physics, { radius: 0.35, height: 1.8, step: 0.3, maxClimbDeg: 45, snap: 0.2, group: 'PLAYER', blockedBy: ['WORLD'] });
  const feet = { x: 0, y: 0, z: 0 }, want = { x: 0, y: -9.81 / 3600, z: 0 };
  let lanes = 0, steps = 0;
  try {
    for (const side of sides) {
      for (let lane = 0; lane <= 22; lane++) {
        const half = ENTRY_WIDTH / 2 - 0.35;
        const offset = -half + lane * (2 * half) / 22;
        feet.x = side === 'east' ? 249.6 : side === 'west' ? -249.6 : offset;
        feet.z = side === 'north' ? 249.6 : side === 'south' ? -249.6 : offset; feet.y = 0.05;
        want.x = 0; want.z = 0;
        for (let settle = 0; settle < 5; settle++) motor.move(feet, want);
        let travelled = 0, stalled = 0;
        for (let step = 0; travelled < 50; step++) {
          want.x = side === 'east' ? -0.1 : side === 'west' ? 0.1 : 0;
          want.z = side === 'north' ? -0.1 : side === 'south' ? 0.1 : 0;
          const before = side === 'north' || side === 'south' ? feet.z : feet.x;
          const result = motor.move(feet, want); steps++;
          const advance = side === 'north' || side === 'east' ? before - (side === 'north' ? feet.z : feet.x) : (side === 'south' ? feet.z : feet.x) - before;
          travelled += advance; stalled = advance < 0.05 ? stalled + 1 : 0;
          const lateral = side === 'north' || side === 'south' ? feet.x : feet.z;
          const water = waterAt(feet.x, feet.z);
          if (water !== null && water > feet.y + 0.15) throw new Error(`Submerged edge entry ${side} lane ${lane}`);
          // A single floor-contact retry is ordinary motor behavior; five stalled ticks are a blocked route.
          if (!result.grounded || stalled >= 5 || step >= 600 || Math.abs(lateral - offset) > 0.35 || Math.abs(feet.y) > 0.15 || result.groundNormalY < 0.99) throw new Error(`Blocked edge entry ${side} lane ${lane} at ${travelled.toFixed(2)}m (grounded=${result.grounded}, freedom=${result.horizontalFreedom}, y=${feet.y}, normal=${result.groundNormalY})`);
        }
        lanes++;
      }
    }
    return { lanes, steps };
  } finally { motor.dispose(); }
}
