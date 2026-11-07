// @vitest-environment happy-dom
import { beforeAll, expect, test } from 'vitest';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { allowDeveloperBoost } from '../src/server/engine/sim/playerSim';
import { linkedPlayer } from './fixtures/motion-trace/link';
import { loadCourseRapier, type MotionScenario } from './fixtures/motion-trace/parity';

// The Developer boost crosses the wire: DL17's lap, DL23's play and Jake's sitting all read the first 30 s at boost, and after the
// flip the server decides how fast the board goes.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });
const scenario: MotionScenario = { id: 'boost', start: { x: -10, z: 0, yaw: -Math.PI / 2 }, ticks: 0, intent: () => ({}) };

/** The server's board speed after a run up with the boost held on every command. */
function topSpeed(): number {
  const link = linkedPlayer(R, scenario, 3);
  try {
    for (let at = 0; at < 10; at++) link.run();
    link.run({ buttons: NET_BUTTONS.hover });
    for (let at = 0; at < 90; at++) link.run({ buttons: NET_BUTTONS.boost });
    return Math.hypot(link.host.player.velocity.x, link.host.player.velocity.z);
  } finally { link.dispose(); }
}

test('a host that doesn\'t allow it ignores the button, and a standalone server honours it', () => {
  expect(topSpeed()).toBeLessThanOrEqual(14.01);
  allowDeveloperBoost();
  expect(topSpeed()).toBeGreaterThan(20);
});
