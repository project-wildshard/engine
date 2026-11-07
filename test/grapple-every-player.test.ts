// oxlint-disable-next-line import/no-nodejs-modules -- Native traversal uses the shipped physics binary.
import { installGrapple } from '@wildshard/engine/game/grapple/native';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { tagCollider } from '@wildshard/engine/physics/surface';
import { createSimHost } from '@wildshard/engine/sim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { parseGrappleProfile } from '@wildshard/format/grapple';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import source from './fixtures/engine-lift/grapple.json' with { type: 'json' };
import { SIM_LEVEL } from './fixtures/sim-level/level';

const quarry = parseGrappleProfile({ ...source, id: 'tool.quarry-claw', course: {
  name: 'Quarry', mode: { ...source.course.mode, zipSpeed: 14 },
  clearance: { axis: 'x', plane: 0, min: -4, max: 4, base: 0, top: 2, ceiling: 8, owners: ['quarry.rail'] },
}, headless: { step: 'quarry.claw', lock: 'quarry.lock', aim: 'quarry.pitch', eye: 1.68, aspect: 1, portraitFov: 70 },
  fact: { name: 'quarry.crossed', entity: 'quarry.pit', source: 'quarry.crossing' } });
const mode = quarry.course.mode ?? { ...source.course.mode, id: 'grapple' };

const wire = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : null;

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

test('a bot locks, fires and crosses on its own claw while the lead stands idle', async () => {
  const { host, rail, lead, bot, grapple, facts } = await quarryRoom();
  try {
    host.step(); expect(grapple.clawOf(bot.id)?.phase).toBe('idle');
    grapple.press(bot.id, { lock: true }); host.step();
    const claw = grapple.clawOf(bot.id); if (claw === undefined) throw new Error('Missing bot claw');
    expect(claw).not.toBe(grapple.sim); expect(claw.target).not.toBeNull(); expect(grapple.sim.target).toBeNull();
    expect(bot.led).toBe(false); // a lock is aim: only a crossing takes the body
    grapple.press(bot.id, { fire: true }); host.step();
    expect(claw.phase).not.toBe('idle'); expect(grapple.sim.phase).toBe('idle');
    expect(grapple.guardOpen()).toBe(true); expect(rail.isEnabled()).toBe(false);
    expect(bot.led).toBe(true); expect(lead.led).toBe(false); // the server carries this body, and no one else's
    const leadAt = lead.position.clone();
    for (let frame = 0; frame < 240; frame++) host.step();
    expect(claw.phase).toBe('idle'); expect(grapple.guardOpen()).toBe(false); expect(rail.isEnabled()).toBe(true);
    expect(bot.led).toBe(false);
    expect(bot.position.x).toBeLessThan(-1); expect(Math.hypot(lead.position.x - leadAt.x, lead.position.z - leadAt.z)).toBeLessThan(.05); // it stands off the level, so it falls
    expect(facts).toEqual(['quarry.crossed']);
  } finally { host.dispose(); }
});

test('P1-E5.3: the hook a client names is bitten, though the server has no camera to pick it with, and a bad one is nothing', async () => {
  const { host, bot, grapple } = await quarryRoom();
  try {
    bot.yaw = -Math.PI / 2; // the server's own eye looks away from the only hook
    host.step(); grapple.press(bot.id, { lock: true }); host.step();
    const claw = grapple.clawOf(bot.id); if (claw === undefined) throw new Error('Missing bot claw');
    expect(claw.target).toBeNull(); expect(claw.armedMiss).toBe(true);
    claw.release();
    grapple.press(bot.id, { lock: true, hook: 9 }); host.step();
    expect(claw.target).toBeNull();
    claw.release();
    grapple.press(bot.id, { lock: true, hook: 0 }); host.step();
    expect(claw.target?.hook.x).toBe(-4);
    claw.release();
    bot.position.x = 900; bot.motor.resetAt(bot.position); // past the claw's range, whatever a client says
    grapple.press(bot.id, { lock: true, hook: 0 }); host.step();
    expect(claw.target).toBeNull();
  } finally { host.dispose(); }
});

test('a mid-air claw saves with its player, one player saves no extra row', async () => {
  const { host, bot, grapple } = await quarryRoom();
  try {
    const adapter = host.adapters.get('quarry.claw'); if (adapter === undefined) throw new Error('Missing grapple adapter');
    expect(wire(adapter.snapshot())).not.toHaveProperty('others');
    host.step(); grapple.press(bot.id, { lock: true }); host.step(); grapple.press(bot.id, { fire: true }); host.step();
    for (let frame = 0; frame < 30; frame++) host.step();
    const saved = adapter.snapshot(), claw = grapple.clawOf(bot.id);
    expect(wire(saved)).toHaveProperty('others');
    const phase = claw?.phase, at = claw?.clock;
    expect(phase).not.toBe('idle');
    host.step(); adapter.restore(saved);
    expect(claw?.phase).toBe(phase); expect(claw?.clock).toBe(at); expect(adapter.snapshot()).toBe(saved);
    host.removePlayer(bot.id); host.step();
    expect(grapple.clawOf(bot.id)).toBeUndefined(); expect(grapple.guardOpen()).toBe(false);
  } finally { host.dispose(); }
});
