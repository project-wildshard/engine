import { expect, test } from 'vitest';
import type { TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { heldArmsOf } from '../src/server/game/weapons/nativeHeld';
import { mountedPlayerOf } from '../src/server/game/riding/native';
import { openArenaOf } from '../src/server/game/boss/openArenaNative';
import { readArenaScriptData } from '../src/shared/game/boss/openArenaFight';
import { admittedResidents, press, step } from './fixtures/engine-lift/residents';

// Split from engine-rule-successors.test.ts (VITEST-BENCH VB5): the Titan chain's cases run in order, each resuming
// the save the one before earned, so they stay together in one file.
const { input, open } = admittedResidents(['nalati-grasslands']);

let titanFight: ReturnType<typeof snapshotSimHostBytes> | undefined;
let titanWind: ReturnType<typeof snapshotSimHostBytes> | undefined, titanFire: ReturnType<typeof snapshotSimHostBytes> | undefined;
let titanArrows: ReturnType<typeof snapshotSimHostBytes> | undefined, titanWindAt: number | undefined;
let titanSupport: ReturnType<typeof snapshotSimHostBytes> | undefined, titanSupportHp: number | undefined, titanRiderChip: number | undefined;
let titanContact: ReturnType<typeof snapshotSimHostBytes> | undefined, titanBurning: ReturnType<typeof snapshotSimHostBytes> | undefined;
let titanSpent: ReturnType<typeof snapshotSimHostBytes> | undefined, titanFireCell: { cell: number; active: number; spent: number } | undefined;

// Each bounded continuation consumes the preceding actual save, never a
// hand-built phase. Bow damage and fire contact/burning/spent checkpoints
// bound the native work per case without changing simulation speed or caps.
function earnTitanPhase(live: TrustedHeadlessResident, goal: number, health?: number): void {
  const host = live.host, player = leadPlayer(host), mount = mountedPlayerOf(host), arena = openArenaOf(host);
  if (mount === undefined || arena === undefined) throw new Error('Missing actual Titan continuation');
  host.combat.playerRules(host.scope, { bossGod: true });
  let blade = false;
  for (let tick = 0; tick < 6000 && arena.boss.phase < goal; tick++) {
    if (health !== undefined && !(arena.fight.hpFrac > health)) break;
    if (tick % 900 === 0) heldArmsOf(host)?.of(player).refill();
    const rider = arena.boss.phase === 1 ? [...host.entities.values()].find(body => body.alive && body.kind === 'ghost-rider') : undefined;
    const target = rider?.position.clone() ?? arena.fight.rowlessFocus(), p = player.position;
    if (rider !== undefined) {
      if (mount.mounted) mount.dismount();
      if (!blade) { step(live, 1, [{ kind: 'script', actorId: 'nalati.weapon.swap', value: 1 }]); blade = true; }
      player.resetPose({ x: target.x + 1.2, y: target.y, z: target.z }, Math.PI / 2); target.y += rider.dims.bodyY;
    } else if (blade) { step(live, 1, [{ kind: 'script', actorId: 'nalati.weapon.swap', value: 0 }]); blade = false; }
    const dx = target.x - p.x, dz = target.z - p.z, pitch = Math.atan2(target.y - p.y - 1.68, Math.hypot(dx, dz));
    live.step([{ kind: 'player', moveX: 0, moveZ: 0, commandVersion: 1, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: Math.atan2(-dx, -dz), pitch,
      ...(rider !== undefined ? tick % 24 === 0 ? { swing: true } : {} : tick % 90 < 60 ? { heavy: {} } : {}) },
    { kind: 'script', actorId: 'nalati.weapon.aim', value: 1 }, { kind: 'script', actorId: 'nalati.weapon.pitch', value: pitch }]);
  }
  if (health === undefined) expect(arena.boss.phase).toBe(goal);
  else {
    expect(arena.fight.hpFrac).toBeLessThanOrEqual(health); expect(arena.boss.phase).toBe(goal - 1);
    // Save a real weapon selection too: the last rider can die while the
    // blade is still held, before the ordinary loop switches back to bow.
    if (goal === 2) step(live, 1, [{ kind: 'script', actorId: 'nalati.weapon.swap', value: 0 }]);
  }
}

test('real mounted entry earns the Titan fight checkpoint', async () => {
  const live = await open('nalati-grasslands');
  try {
    const host = live.host, player = leadPlayer(host), mount = mountedPlayerOf(host), arena = openArenaOf(host);
    const product = input('nalati-grasslands').product;
    if (mount?.mountables[0] === undefined || arena === undefined || product === undefined) throw new Error('Missing actual Titan world');
    const data = await readArenaScriptData(product, { fight: 'combat/titan-fight.json', geometry: 'combat/titan-geometry.json' });
    titanWindAt = data.phases[1]?.at;
    titanRiderChip = data.tuning.riderChip;
    step(live, 120);
    const horse = mount.mountables[0]; player.resetPose(horse.position, horse.yaw); expect(mount.mount(horse.entityId)).toBe(true);
    const cairn = arena.fight.cairnSpot(); mount.teleport(cairn.x, cairn.z, 0);
    actRoutes(host).climate?.({ op: 'force', name: 'storm', at: .1 });
    for (let tick = 0; tick < 4000 && !arena.storm(); tick++) step(live);
    expect(arena.storm()).toBe(true); press(live, 'nalati.titan.tie');
    expect(arena.fight.tied).toBe(true);
    host.combat.playerRules(host.scope, { bossGod: true });
    for (let tick = 0; tick < 240 && arena.boss.state !== 'fight'; tick++) live.step([{ kind: 'script', actorId: 'nalati.titan.skip', value: 1 }]);
    expect(arena.boss.state).toBe('fight');
    mount.teleport(data.arena.center.x + 10, data.arena.center.z + 10, 0);
    titanFight = snapshotSimHostBytes(host);
  } finally { live.dispose(); }
}, 10_000);

for (const quarter of [1, 2, 3, 4]) test(`real mounted arrows earn and resume Titan damage checkpoint ${quarter}/4`, async () => {
  const saved = quarter === 1 ? titanFight : titanArrows;
  if (saved === undefined || titanWindAt === undefined) throw new Error('Real mounted play must earn the preceding checkpoint');
  const live = await open('nalati-grasslands', saved);
  try {
    expect(live.effects).toEqual([]);
    expect(openArenaOf(live.host)?.boss.state).toBe('fight');
    earnTitanPhase(live, 1, quarter === 4 ? undefined : 1 - (1 - titanWindAt) * quarter / 4);
    titanArrows = snapshotSimHostBytes(live.host);
    if (quarter === 4) { titanWind = titanArrows; titanSupportHp = openArenaOf(live.host)?.fight.hpFrac; }
  } finally { live.dispose(); }
}, 10_000);

for (const goal of [1, 2, 3, 4]) test(`real support melee earns and resumes Titan rider checkpoint ${goal}/4`, async () => {
  const saved = goal === 1 ? titanWind : titanSupport;
  if (saved === undefined || titanSupportHp === undefined || titanRiderChip === undefined) throw new Error('Actual combat must earn the preceding checkpoint');
  const live = await open('nalati-grasslands', saved);
  try {
    expect(live.effects).toEqual([]);
    earnTitanPhase(live, 2, goal === 4 ? undefined : titanSupportHp - titanRiderChip * (goal - .5));
    titanSupport = snapshotSimHostBytes(live.host);
    if (goal === 4) {
      expect(openArenaOf(live.host)?.fight.snapshot().fireOn).toBe(true);
      titanFire = titanSupport;
    }
  } finally { live.dispose(); }
}, 10_000);

test('earned Titan fire keeps its actual contact cooldown', async () => {
  if (titanFire === undefined) throw new Error('Actual support deaths must earn the preceding fire checkpoint');
  const live = await open('nalati-grasslands', titanFire);
  try {
    const host = live.host, player = leadPlayer(host), mount = mountedPlayerOf(host), arena = openArenaOf(host), product = input('nalati-grasslands').product;
    if (mount === undefined || arena === undefined || product === undefined) throw new Error('Missing actual Titan fire continuation');
    expect(live.effects).toEqual([]);
    const data = await readArenaScriptData(product, { fight: 'combat/titan-fight.json', geometry: 'combat/titan-geometry.json' });
    const field = arena.fight.snapshot().field, cell = field.modes.indexOf(data.field.states.active);
    expect(cell).toBeGreaterThanOrEqual(0);
    const x = data.field.x + (cell % data.field.width + .5) * data.field.cell;
    const z = data.field.z + (Math.floor(cell / data.field.width) + .5) * data.field.cell;
    if (mount.mounted) mount.teleport(x, z, 0);
    else player.resetPose({ x, y: host.groundHeightAt(x, z), z }, 0);
    const contacts: number[] = [];
    host.events.on('damage.dealt', event => { if (event.req.target === player.health && event.req.toast === data.lines.burning && event.dealt > 0) contacts.push(host.state.tick); }, host.scope);
    step(live, 30); expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.every((tick, index) => index === 0 || tick - (contacts[index - 1] ?? 0) >= 5)).toBe(true);
    titanFireCell = { cell, active: data.field.states.active, spent: data.field.states.spent };
    titanContact = snapshotSimHostBytes(host);
  } finally { live.dispose(); }
}, 10_000);

test('contacted Titan fire advances a real burning save checkpoint', async () => {
  if (titanContact === undefined || titanFireCell === undefined) throw new Error('Actual burning contact must earn this checkpoint');
  const live = await open('nalati-grasslands', titanContact);
  try {
    expect(live.effects).toEqual([]);
    live.host.combat.playerRules(live.host.scope, { bossGod: true });
    const tick = live.host.state.tick;
    step(live, 180); expect(live.host.state.tick).toBe(tick + 180);
    const arena = openArenaOf(live.host); if (arena === undefined) throw new Error('Titan did not resume');
    expect([titanFireCell.active, titanFireCell.spent]).toContain(arena.fight.snapshot().field.modes[titanFireCell.cell]);
    titanBurning = snapshotSimHostBytes(live.host);
  } finally { live.dispose(); }
}, 10_000);

test('the real burning checkpoint earns a spent Titan cell', async () => {
  if (titanBurning === undefined || titanFireCell === undefined) throw new Error('Actual fire steps must earn this checkpoint');
  const live = await open('nalati-grasslands', titanBurning);
  try {
    expect(live.effects).toEqual([]);
    live.host.combat.playerRules(live.host.scope, { bossGod: true });
    const arena = openArenaOf(live.host); if (arena === undefined) throw new Error('Titan did not resume');
    let spent = false;
    for (let tick = 0; tick < 1800 && !spent; tick++) { step(live); if (tick % 30 === 0) spent = arena.fight.snapshot().field.modes[titanFireCell.cell] === titanFireCell.spent; }
    expect(spent).toBe(true);
    titanSpent = snapshotSimHostBytes(live.host);
  } finally { live.dispose(); }
}, 10_000);

test('the earned spent Titan cell resumes without duplicate effects', async () => {
  if (titanSpent === undefined || titanFireCell === undefined) throw new Error('Actual burning must earn the spent checkpoint');
  const live = await open('nalati-grasslands', titanSpent);
  try {
    expect(live.effects).toEqual([]);
    const continued = openArenaOf(live.host); if (continued === undefined) throw new Error('Titan did not resume');
    step(live, 120);
    expect(continued.fight.snapshot().field.modes[titanFireCell.cell]).toBe(titanFireCell.spent);
  } finally { live.dispose(); }
}, 10_000);
