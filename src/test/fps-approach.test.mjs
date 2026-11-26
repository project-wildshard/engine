import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { fpsVerdict } from '../scripts/fps/verdict.mjs';
import { routeLegOnPage } from '../scripts/memory/iphone/route.mjs';

function walk({ approach, blocked = false, stepMs = 16, burst = 1, dieAt = Infinity }) {
  let now = 0, next;
  const held = new Map();
  const player = { position: { x: 0, z: 0 }, yaw: Math.PI };
  const game = { app: { input: { setHeld: (key, value) => held.set(key, value) } },
    frameGate: () => true, frameCount: 0, frameMs: Array(120).fill(stepMs),
    updateMs: Array(120).fill(1), renderMs: Array(120).fill(1), frameI: 0,
    lastFrame: { calls: 1, triangles: 1 }, renderer: { info: { programs: [] } } };
  const world = { hud: { entered: true }, game, player };
  const leg = { name: 'reversal', kind: 'walk', seconds: 3, points: [[0, -10]],
    reach: 1, fixed: true, cap: null, approach };
  // the app mirrors its state on <html data-ws-state>; a death card names the cause
  const page = { visibilityState: 'visible', documentElement: { dataset: { wsState: 'play' } },
    querySelector: () => ({ textContent: ' Mauled by a black bear ' }) };
  const result = runInNewContext(`(${routeLegOnPage.toString()})(leg)`, {
    leg, window: { __wildshard: { world } }, document: page,
    performance: { now: () => now }, setTimeout: () => 1, clearTimeout: () => {},
    requestAnimationFrame: callback => { next = callback; },
  });
  now = 16; next();
  const firstYaw = player.yaw;
  while (next && now < 4000) {
    const step = next; next = null;
    now += stepMs; game.frameCount += burst;
    if (now >= dieAt) page.documentElement.dataset.wsState = 'dead';
    if (!blocked && held.get('move.forward')) {
      player.position.x -= Math.sin(player.yaw) * stepMs / 100;
      player.position.z -= Math.cos(player.yaw) * stepMs / 100;
    }
    step();
  }
  return { result, firstYaw, held };
}

test('an approach aligns a reversal while measured walking keeps its turn rate', async () => {
  const approach = walk({ approach: true }), measured = walk({ approach: false });
  expect(Math.abs(approach.firstYaw)).toBe(0);
  expect(Math.abs(measured.firstYaw - Math.PI)).toBeCloseTo(4 * 0.016);
  const result = await approach.result;
  expect(result.error).toBeNull();
  expect(result.nav).toMatchObject({ reached: 1, expected: 1, stuck: [], skipped: 0 });
  expect(result.samples).toEqual([]);
  expect((await measured.result).samples.length).toBeGreaterThan(0);
});

test('an aligned approach still rejects a blocked path and releases movement', async () => {
  const attempt = walk({ approach: true, blocked: true });
  const result = await attempt.result;
  expect(result.error).toBe('incomplete waypoint, dwell or road return');
  expect(result.nav.stuck.length).toBeGreaterThan(0);
  expect(result.nav.reached).toBe(0);
  expect(attempt.held.get('move.forward')).toBe(false);
});


test('a native burst drains the frame ring before it overwrites raw intervals', async () => {
  const result = await walk({ approach: false, stepMs: 1 }).result;
  expect(result.nav.lostFrames).toBe(0);
  expect(result.samples.reduce((sum, sample) => sum + sample.frameMs.length, 0)).toBe(result.frames);
  expect(fpsVerdict([{ name: 'reversal', ...result }], [{ name: 'reversal', seconds: 3 }], 120).verdict).toBe('pass');
});

test('frames genuinely lost between callbacks still invalidate the capture', async () => {
  const result = await walk({ approach: false, stepMs: 1, burst: 121 }).result;
  expect(result.nav.lostFrames).toBeGreaterThan(0);
  expect(fpsVerdict([{ name: 'reversal', ...result }], [{ name: 'reversal', seconds: 3 }], 120).verdict).toBe('incomplete');
});

// DF15 (mini-df15, 11-23): a black bear at the quest fire killed the bench player; the leg names the death, not a jump
test('a death mid-leg ends the leg with its cause and releases movement', async () => {
  const attempt = walk({ approach: false, dieAt: 1000 });
  const result = await attempt.result;
  expect(result.error).toBe('the player died during the route: Mauled by a black bear');
  expect(attempt.held.get('move.forward')).toBe(false);
});
