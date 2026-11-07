import { DECK, FLOOR_DECK, GAP_Z, GATE_Z, HILL_X, LEDGE, POOL_X, RAMP_Z, STEP_Z, terrainHeight, type MotionIntent, type MotionScenario } from './parity';

// P1-E5.3 B2: the scenarios. Each is named for the A row whose done-when it measures, so `ratchet.json` reads as the list
// of what stays to converge. Keep a row's scenarios when it lands: at 0 they hold it.

// yaw 0 faces -z; forward is (-sin yaw, -cos yaw)
const EAST = -Math.PI / 2, WEST = Math.PI / 2, NORTH = Math.PI, SOUTH = 0;
const walk: MotionIntent = { keyY: 1 }, run: MotionIntent = { keyY: 1, sprint: true }, still: MotionIntent = {};
/** `first` for the first `ticks`, else `then`. */
const until = (ticks: number, first: MotionIntent, then: MotionIntent = still) => (tick: number): MotionIntent => tick < ticks ? first : then;
/** Press `press` for one tick at `at`, over the held `held`. */
const pressAt = (at: number, press: MotionIntent, held: MotionIntent = still) => (tick: number): MotionIntent => tick === at ? { ...held, ...press } : held;
const deepWater = { x: POOL_X - 25, y: terrainHeight(POOL_X - 25, 0), z: 0, yaw: WEST } as const;
const ledge = { x: LEDGE.x, y: LEDGE.top, z: LEDGE.z, yaw: EAST } as const;
const open = { x: -10, z: 0, yaw: EAST } as const;
const hill = { x: HILL_X + 2.4, y: terrainHeight(HILL_X + 2.4, 0), z: 0, yaw: EAST } as const;

export const MOTION_SCENARIOS: readonly MotionScenario[] = [
  // A1: one velocity through every mode
  { id: 'A1.walk-onto-board', reaches: ['board'], start: { x: -30, z: 8, yaw: EAST }, ticks: 240, intent: tick => ({ ...walk, ...(tick === 60 ? { hover: true } : {}) }) },
  { id: 'A1.board-off-at-speed', reaches: ['board', 'air'], start: { x: -30, z: 8, yaw: EAST }, ticks: 240, intent: tick => ({ ...walk, ...(tick === 0 || tick === 120 ? { hover: true } : {}) }) },
  { id: 'A1.run-into-water', reaches: ['wade', 'swim'], start: { x: POOL_X + 10, z: 0, yaw: WEST }, ticks: 280, intent: until(220, run) },
  { id: 'A1.swim-out-of-the-water', reaches: ['swim', 'wade'], start: { x: POOL_X - 12, y: 0, z: 0, yaw: EAST }, ticks: 280, intent: until(240, walk) },

  // A2: momentum, and everything that came with displacement
  { id: 'A2.walk-start-stop', start: open, ticks: 240, intent: tick => tick < 60 ? walk : tick < 120 ? still : tick < 180 ? { keyX: 1 } : still },
  { id: 'A2.authored-speed', start: open, ticks: 120, intent: until(90, walk), wire: 'legacy' },
  { id: 'A2.slope-slide', reaches: ['slide'], start: hill, ticks: 150, intent: () => still },
  { id: 'A2.slope-walk-up', start: { x: HILL_X - 3, z: 0, yaw: EAST }, ticks: 180, intent: () => walk },
  { id: 'A2.walk-off-a-ledge', reaches: ['air'], start: ledge, ticks: 180, intent: () => walk },
  { id: 'A2.shove', start: open, ticks: 150, intent: until(100, walk), events: (tick, on, view) => { if (tick === 30) on.shove(view.x - 1, view.z, 6); } },
  { id: 'A2.dash', reaches: ['dash'], start: open, ticks: 120, intent: until(60, walk), events: (tick, on) => { if (tick === 30) on.dash(0, 10, .2); } },
  { id: 'A2.lunge', reaches: ['dash'], start: open, ticks: 120, intent: until(60, walk), events: (tick, on, view) => { if (tick === 30) on.dashTo(view.x + 8, view.z, 1, .25); } },
  { id: 'A2.impulse', start: open, ticks: 150, intent: until(100, walk), events: (tick, on) => { if (tick === 30) on.impulse(0, 0, 8); } },
  { id: 'A2.jump', reaches: ['rose'], start: open, ticks: 150, intent: pressAt(40, { jump: true }, walk) },

  // A3: the wade reads the last resolve
  { id: 'A3.wade-in-and-out', reaches: ['wade'], start: { x: POOL_X + 3, z: 0, yaw: WEST }, ticks: 280, intent: tick => tick < 100 ? walk : tick < 140 ? still : { keyY: -1 } },

  // A4: a resting body steps
  { id: 'A4.rest-on-a-deck', start: { x: DECK.x, y: DECK.y + .1, z: DECK.z, yaw: SOUTH }, ticks: 240, intent: () => ({ idle: true }) },
  { id: 'A4.rest-on-a-slope', reaches: ['slide'], start: hill, ticks: 120, intent: () => ({ idle: true }) },

  // A5: the stroke clock on the stand-up step. A5 landed first: the host still drops its speed there, so this reaches 0 at A1
  { id: 'A5.stand-up', reaches: ['swim', 'wade'], start: { x: POOL_X - 9, y: 0, z: 0, yaw: EAST }, ticks: 180, intent: () => walk },

  // A6: one capsule
  { id: 'A6.step-up', start: { x: -12, z: STEP_Z + 4, yaw: SOUTH }, ticks: 150, intent: () => walk },
  { id: 'A6.narrow-gap', start: { x: 0, z: GAP_Z + 4, yaw: SOUTH }, ticks: 200, intent: () => walk },
  { id: 'A6.climb-42', start: { x: 0, z: RAMP_Z - 3, yaw: NORTH }, ticks: 240, intent: () => walk },

  // A7: the lock-on orbit
  { id: 'A7.orbit', start: { x: 40, z: 60, yaw: SOUTH }, ticks: 240, lockAt: { x: 40, z: 54, r0: 6 }, intent: () => ({ keyX: 1 }) },
  { id: 'A7.close-in', start: { x: 40, z: 60, yaw: SOUTH }, ticks: 180, lockAt: { x: 40, z: 54, r0: 6 }, intent: () => walk },

  // A8: the dodge reads the command
  { id: 'A8.dodge-forward', reaches: ['dash'], start: open, ticks: 90, intent: pressAt(20, { dodge: true }, { keyY: 1 }) },
  { id: 'A8.dodge-back', reaches: ['dash'], start: open, ticks: 90, intent: pressAt(20, { dodge: true }, { keyY: -1 }) },
  { id: 'A8.dodge-left', reaches: ['dash'], start: open, ticks: 90, intent: pressAt(20, { dodge: true }, { keyX: -1 }) },
  { id: 'A8.dodge-right', reaches: ['dash'], start: open, ticks: 90, intent: pressAt(20, { dodge: true }, { keyX: 1 }) },
  { id: 'A8.dodge-still', reaches: ['dash'], start: open, ticks: 90, intent: pressAt(20, { dodge: true }) },
  { id: 'A8.dodge-round-a-target', reaches: ['dash'], start: { x: 40, z: 60, yaw: SOUTH }, ticks: 90, lockAt: { x: 40, z: 54, r0: 6 }, intent: pressAt(20, { dodge: true }, { keyX: 1 }) },
  { id: 'A8.dodge-at-a-target', reaches: ['dash'], start: { x: 40, z: 60, yaw: SOUTH }, ticks: 90, lockAt: { x: 40, z: 54, r0: 6 }, intent: pressAt(20, { dodge: true }, { keyY: 1 }) },
  { id: 'A8.dodge-while-sliding', reaches: ['slide'], start: hill, ticks: 90, intent: pressAt(30, { dodge: true }) },
  { id: 'A8.dodge-cooldown', reaches: ['dash'], start: open, ticks: 150, intent: tick => ({ ...walk, ...(tick === 10 || tick === 80 ? { dodge: true } : {}) }), events: (tick, on) => { if (tick === 0) on.dodgeCooldownScale(.5); } },

  // A9: the first jump's coyote window
  { id: 'A9.jump-off-a-ledge', reaches: ['air', 'rose'], start: ledge, ticks: 200, intent: (() => {
    let left: number | null = null;
    return (tick, view) => {
      if (!view.grounded && left === null) left = tick;
      return { ...walk, ...(left !== null && tick === left + 5 ? { jump: true } : {}) };
    };
  })() },

  // A10: what the page reads and the host does not
  { id: 'A10.effect-slow', start: open, ticks: 120, intent: () => walk, events: (tick, on) => { if (tick === 20) on.effect(.5, false); } },
  { id: 'A10.effect-locked', start: open, ticks: 120, intent: () => walk, events: (tick, on) => { if (tick === 20) on.effect(1, true); if (tick === 60) on.effect(1, false); } },
  { id: 'A10.carried', start: open, ticks: 120, intent: () => walk, events: (tick, on) => { if (tick === 20) on.carried(true); if (tick === 60) on.carried(false); } },
  { id: 'A10.floor-function', start: { x: FLOOR_DECK.x - 6, z: FLOOR_DECK.z, yaw: EAST }, ticks: 200, intent: () => walk },
  { id: 'A10.board-limit', reaches: ['board'], start: { x: -30, z: 8, yaw: EAST }, ticks: 200, intent: tick => ({ ...walk, ...(tick === 0 ? { hover: true } : {}) }), events: (tick, on) => { if (tick === 0) on.boardLimit(7); } },
  { id: 'A10.move-scale', start: open, ticks: 120, intent: () => walk, events: (tick, on) => { if (tick === 20) on.moveScale(.4); } },

  // A11: one applyImpulse
  { id: 'A11.impulse-up', reaches: ['air'], start: open, ticks: 120, intent: () => still, events: (tick, on) => { if (tick === 10) on.impulse(0, 6, 0); } },
  { id: 'A11.impulse-while-swimming', reaches: ['swim'], start: deepWater, ticks: 120, intent: () => still, events: (tick, on) => { if (tick === 30) on.impulse(5, 0, 0); } },
  { id: 'A11.impulse-while-locked', start: open, ticks: 90, intent: () => still, events: (tick, on) => { if (tick === 5) on.effect(1, true); if (tick === 30) on.impulse(5, 0, 0); if (tick === 60) on.effect(1, false); } },
  { id: 'A11.impulse-on-the-board', reaches: ['board', 'rose'], start: open, ticks: 120, intent: tick => tick === 0 ? { hover: true } : still, events: (tick, on) => { if (tick === 40) on.impulse(0, 5, 0); } },

  // A12: one board toggle
  { id: 'A12.board-round-trip-still', reaches: ['board'], start: open, ticks: 150, intent: tick => tick === 10 || tick === 80 ? { hover: true } : still },
  { id: 'A12.board-in-the-air', reaches: ['board'], start: open, ticks: 150, intent: tick => tick === 10 ? { jump: true } : tick === 20 ? { hover: true } : still },
  { id: 'A12.board-in-the-water', reaches: ['swim', 'board'], start: deepWater, ticks: 180, intent: tick => tick === 40 ? { hover: true } : tick === 120 ? { hover: true } : still },

  // A13: a gate this player opened
  { id: 'A13.walk-through-a-gate', start: { x: -32, z: GATE_Z - 3, yaw: NORTH }, ticks: 120, intent: () => walk, events: (tick, on) => { if (tick === 0) on.phaseGate(); } },

  // A14: the swell clock
  { id: 'A14.pond-bob', reaches: ['swim'], start: deepWater, ticks: 300, intent: () => still },
  { id: 'A14.sea-swell', reaches: ['swim'], start: deepWater, ticks: 300, intent: () => still, sea: true },
  { id: 'A14.swim-across', reaches: ['swim'], start: deepWater, ticks: 240, intent: () => walk },
  { id: 'A14.dive', reaches: ['swim'], start: deepWater, ticks: 200, intent: tick => tick < 90 ? { dive: true } : tick < 160 ? { surface: true } : still },

  // A16: what "forward" means to a sprint
  { id: 'A16.sprint-stick-45', start: open, ticks: 100, intent: () => ({ stickX: 90 / 127, stickY: 90 / 127, sprint: true }) },
  { id: 'A16.sprint-strafe', start: open, ticks: 100, intent: () => ({ keyX: 1, sprint: true }) },
  { id: 'A16.sprint-crouched', start: open, ticks: 100, intent: () => ({ keyY: 1, sprint: true, crouch: true }) },
  { id: 'A16.sprint-into-deep-wading', reaches: ['wade'], start: { x: POOL_X + 4, z: 0, yaw: WEST }, ticks: 120, intent: () => run },

  // A17: one reset
  { id: 'A17.reset-mid-run', start: open, ticks: 120, intent: until(100, run), events: (tick, on) => { if (tick === 50) on.reset(-10, 0, 10, WEST); } },
  { id: 'A17.reset-mid-air', reaches: ['air'], start: ledge, ticks: 150, intent: () => walk, events: (tick, on, view) => { if (tick === 100 && !view.grounded) on.reset(-10, 0, 10, EAST); else if (tick === 100) on.reset(-10, 4, 10, EAST); } },
  { id: 'A17.reset-swimming', reaches: ['swim'], start: deepWater, ticks: 120, intent: until(40, walk), events: (tick, on) => { if (tick === 50) on.reset(-10, 0, 0, EAST); } },
];
