// oxlint-disable-next-line import/no-nodejs-modules -- Native traversal uses the shipped physics binary.
import { installGrapple } from '@wildshard/engine/game/grapple/native';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { tagCollider } from '@wildshard/engine/physics/surface';
import { createSimHost } from '@wildshard/engine/sim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { parseGrappleProfile } from '@wildshard/format/grapple';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import type { NetHookWire } from '../src/client/engine/net/netPlayer';
import { netClaw } from '../src/client/game/grapple/netClaw';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { grappleCourse } from '../src/shared/game/grapple/course';
import type { GrappleView } from '../src/shared/game/grapple/sim';
import { directLoopback } from '../src/test/engine/netLoopback';
import source from './fixtures/engine-lift/grapple.json' with { type: 'json' };
import { SIM_LEVEL } from './fixtures/sim-level/level';

const quarry = parseGrappleProfile({ ...source, id: 'tool.quarry-claw', course: {
  name: 'Quarry', mode: { ...source.course.mode, zipSpeed: 14 },
  clearance: { axis: 'x', plane: 0, min: -4, max: 4, base: 0, top: 2, ceiling: 8, owners: ['quarry.rail'] },
}, headless: { step: 'quarry.claw', lock: 'quarry.lock', aim: 'quarry.pitch', eye: 1.68, aspect: 1, portraitFov: 70 },
  fact: { name: 'quarry.crossed', entity: 'quarry.pit', source: 'quarry.crossing' } });
const mode = quarry.course.mode ?? { ...source.course.mode, id: 'grapple' };

async function quarryRoom() {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  const rail = host.physics.world.createCollider(rapier.ColliderDesc.cuboid(.2, 1, 4).setTranslation(0, 1, 0));
  tagCollider(rail, 'stone', 'quarry.rail'); host.physics.step();
  const lead = leadPlayer(host); lead.position.set(40, .12, 0); lead.yaw = Math.PI / 2;
  const bot = host.addPlayer('bot.1', { x: 4, y: .12, z: 0 }, Math.PI / 2);
  const facts: string[] = [];
  const grapple = installGrapple(host, { commands: () => [], emit: effect => { facts.push(effect.name); } }, quarry, mode, [{ x: -4, y: 2, z: 0 }], [rail.handle]);
  return { host, rail, lead, bot, grapple, facts };
}

// E6 WORLD: the claw a view draws, fed off the wire, follows the server's through a whole crossing, and a press carries its hook.
test('a claw on the wire follows the server through a crossing', async () => {
  const { host, lead, grapple } = await quarryRoom();
  try {
    lead.position.set(4, .12, 0);
    const link = directLoopback(), client = new NetClient(link.client), room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
    room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
    const pressed: (number | undefined)[] = [], fires: number[] = [];
    const wire: NetHookWire = { lock: hook => { pressed.push(hook); return 0; }, fire: () => { fires.push(1); } };
    const claw = netClaw(client, lead.id, wire, grappleCourse({ ...quarry.course, mode, hooks: [{ x: -4, y: 2, z: 0 }] })), server = grapple.sim;
    const run = (ticks: number): void => { for (let tick = 0; tick < ticks; tick++) { room.tick(); link.pump(); } };
    const view: GrappleView = { eye: lead.position, project: (point, out) => out.copy(point), forward: out => out.set(0, 0, -1) };
    run(4); expect(claw.phase).toBe('idle');
    // a press: the hook goes out by its index, and the view has its answer before the server's frame
    const hook = claw.course.hooks[0]; if (hook === undefined) throw new Error('Missing hook');
    expect(claw.lock(view, { hook, landing: hook, approach: hook, lifts: false }, false)).toBe('locked');
    expect(pressed).toEqual([0]); expect(claw.target?.hook).toBe(hook);
    expect(claw.fire(view)).toBe(true); expect(fires).toEqual([1]);
    grapple.press(lead.id, { lock: true, hook: 0 }); run(1); grapple.press(lead.id, { fire: true }); run(3);
    // the crossing, phase by phase: every event the view plays, in order
    const seen: string[] = [];
    for (let tick = 0; tick < 300 && (server.phase !== 'idle' || tick < 8); tick++) { run(1); seen.push(...claw.drainEvents().map(event => event.kind)); }
    run(4); seen.push(...claw.drainEvents().map(event => event.kind));
    expect(seen).toEqual(['fire', 'bite', 'zip', 'release']);
    expect(claw.phase).toBe('idle'); expect(claw.target).toBeNull(); expect(claw.holding()).toBe(false);
    expect(client.dropped).toBe(0);
  } finally { host.dispose(); }
});
