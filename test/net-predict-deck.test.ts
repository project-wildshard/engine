// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/wire/netCommand';
import { Euler, Quaternion, Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import { predictedPlayer, PredictionWorld } from '../src/client/engine/net/predictionWorld';
import { Predictor } from '../src/client/engine/net/predictor';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { quantiseCommand } from '../src/shared/engine/net/command';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { RopeChain, type RopeChainSpec } from '../src/shared/engine/physics/ropeChain';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// NET-LAG NL5 (Jake, 2026-11-12: "i fucking clipped through the rope bridge because of the lag lol"). The cause was the
// server's: it built no rope chain (`net-server-rope-deck.test.ts`). This pins the page's half. The real Player and PlayerSim,
// each with its own rope chain shaped as Driftwood's `ropeBridgeSegments` lays a span (not its baked facts: 0.9 m segments,
// 5 cm half thickness, 0.85 m half width, 14 kg), cross it `delay` ticks apart each way: with a chain on both sides they agree, and a correction that writes the
// server's feet up to 1 m under the page's planks (a server whose chain sags differently) replays back onto them, never under.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const A = { x: -25, z: -55 }, B = { x: -5, z: -55 }, ANCHOR_Y = 3, SAG = 1, HALF_Y = 0.05, EAST = -Math.PI / 2;
const PY = PLAYER_CLASS.owner.findIndex(column => column.name === 'py');
/** Feet this far under the page's own plank top are under the plank (it is 10 cm thick): through the deck. */
const UNDER = 2 * HALF_Y + 0.05;

/** The top of the page's plank under (x, z), from the chain's live segment poses; null off the span. */
function deckTop(chain: RopeChain, x: number, z: number): number | null {
  const q = new Quaternion(), local = new Vector3(), top = new Vector3();
  for (const [i, body] of chain.bodies.entries()) {
    const c = body.translation(), r = body.rotation(), hz = chain.spec.segments[i]?.hz ?? 0;
    q.set(r.x, r.y, r.z, r.w);
    local.set(x - c.x, 0, z - c.z).applyQuaternion(q.clone().invert());
    if (Math.abs(local.z) > hz || Math.abs(local.x) > chain.spec.hx) continue;
    top.set(0, chain.spec.hy, local.z).applyQuaternion(q);
    return c.y + top.y;
  }
  return null;
}

/** A rope span as Driftwood's `ropeBridgeSegments` lays it: chords of a sagging catenary, top faces on it. */
function span(): RopeChainSpec {
  const len = Math.hypot(B.x - A.x, B.z - A.z), dx = (B.x - A.x) / len, dz = (B.z - A.z) / len, n = Math.max(6, Math.round(len / 0.9)), yaw = Math.atan2(dx, dz);
  const top = (t: number): number => ANCHOR_Y - SAG * 4 * t * (1 - t) + 0.03, q = new Quaternion(), up = new Vector3();
  const segments: RopeChainSpec['segments'] = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, y0 = top(t0), y1 = top(t1), run = len / n, sm = (t0 + t1) / 2 * len;
    q.setFromEuler(new Euler(-Math.atan2(y1 - y0, run), yaw, 0, 'YXZ')); up.set(0, 1, 0).applyQuaternion(q);
    segments.push({ x: A.x + dx * sm - up.x * HALF_Y, y: (y0 + y1) / 2 - up.y * HALF_Y, z: A.z + dz * sm - up.z * HALF_Y, rot: { x: q.x, y: q.y, z: q.z, w: q.w }, hz: Math.hypot(run, y1 - y0) / 2 });
  }
  return { segments, hx: 1.4 / 2 + 0.15, hy: HALF_Y, mass: 14 };
}

interface Crossing { readonly under: number; readonly corrections: number; readonly endX: number }
/** One crossing, page and server `delay` ticks apart each way; `sink`: metres off the server's feet in one frame mid-span. */
function cross(delay: number, sprint: boolean, sink: number): Crossing {
  const scenario: MotionScenario = { id: 'rope-deck', start: { x: A.x + 0.6, z: A.z, y: ANCHOR_Y + 0.03, yaw: EAST }, ticks: 0, intent: () => ({}) };
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), { player } = page, world = new PredictionWorld(page.physics);
  const chains = [new RopeChain(page.physics, span()), new RopeChain(host.host.physics, span())];
  const predictor = new Predictor(predictedPlayer(player, world), PLAYER_CLASS.owner);
  const up: NetCommand[][] = [], down: { seq: number; tick: number; owner: Float64Array }[][] = [];
  for (let at = 0; at < delay; at++) { up.push([]); down.push([]); }
  let seq = 0, under = 0, sunk = false;
  try {
    for (let tick = 0; tick < 600 && player.position.x < B.x - 0.6; tick++) {
      seq++;
      const command = quantiseCommand({ seq, viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: EAST, pitch: 0, buttons: sprint ? NET_BUTTONS.sprint : 0 });
      world.poseFor(seq, false);
      page.stepWorld(); predictor.step(command);
      up.push([command]);
      const arrived: { seq: number; tick: number; owner: Float64Array }[] = [];
      for (const held of up.shift() ?? []) {
        host.host.step(new Map([[host.player.id, held]]));
        const owner = new Float64Array(PLAYER_CLASS.owner.length);
        PLAYER_CLASS.owner.forEach((column, index) => { owner[index] = column.sample(host.player, () => 0); });
        arrived.push({ seq: held.seq, tick: host.host.state.tick, owner });
      }
      down.push(arrived);
      for (const frame of down.shift() ?? []) {
        if (sink !== 0 && !sunk && player.position.x > (A.x + B.x) / 2 - 3) { frame.owner[PY] = (frame.owner[PY] ?? 0) - sink; sunk = true; }
        world.frame(frame.tick, frame.seq);
        predictor.reconcile(frame.seq, frame.owner);
      }
      const top = deckTop(chains[0] as RopeChain, player.position.x, player.position.z);
      if (top !== null && player.position.x > A.x + 1 && player.position.x < B.x - 1 && top - player.position.y > UNDER) under++;
    }
    return { under, corrections: predictor.corrections, endX: player.position.x };
  } finally {
    for (const chain of chains) chain.dispose();
    world.dispose(); page.dispose(); host.dispose();
  }
}

test('with a chain on both sides a crossing needs no correction, walking or sprinting', () => {
  for (const sprint of [false, true]) {
    const run = cross(6, sprint, 0);
    expect(run.corrections).toBe(0);
    expect(run.under).toBe(0);
    expect(run.endX).toBeGreaterThan(B.x - 1);
  }
});

test('a correction from a server up to 1 m lower replays onto the planks, never under them', () => {
  for (const sink of [0.3, 1]) for (const sprint of [false, true]) for (const delay of [3, 6, 9]) {
    const run = cross(delay, sprint, sink), label = `sink ${sink} delay ${delay} sprint ${sprint}`;
    expect(run.corrections, label).toBeGreaterThan(0);
    expect(run.under, label).toBe(0);
    expect(run.endX, label).toBeGreaterThan(B.x - 1);
  }
});
