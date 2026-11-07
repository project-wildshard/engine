import {admissionPage,lendNalatiPasture} from './fixtures/nalati-return-modules';
import {Scope} from '../src/shared/engine/app/scope';
import { NALATI_PASTURE as pasture } from './fixtures/nalati-titan';
import { fixtureNativeRoster } from './fixtures/native-roster';
// oxlint-disable-next-line import/no-nodejs-modules -- Native ownership tests use the actual shipped Rapier binary.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { Rng } from '../src/shared/engine/core/rng';
import { HuntBrain, type HuntBody } from '../src/server/engine/ai/hunt';
import { NativeManager } from '../src/server/game/population/nativeManager';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';

import { BOAR } from '../src/client/game/systems/species/boar';
import { Vector3 } from 'three';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { admitNativeRosterServices, createNativeCreatureRoster } from '../src/server/game/shardfile/homeKeeper';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

test('orchard roster phases keep native charge order and reject dead, stunned or foreign movement', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), rng = new Rng(83);
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native recipe');
  const { hunt, services } = fixtureNativeRoster(host, rng), order: string[] = [];
  const rows = { specs: [sample.spec], variants: new Map(), rng, services, hunted: 'every' as const, spawnY: 10,
    bodyPhase: { animateWithin: 50, clearWithin: 3 } };
  const intake = createNativeCreatureRoster(host, rows);
  try {
    const body = intake.body('orchard.guard', sample.spec.kind, sample.spec.variant, -1, { x: 4, z: 4 }, 0, [1, 1]);
    const actor = intake.arrive(body); actor.state = 'charge';
    const motion = vi.spyOn(hunt, 'advanceCharge').mockImplementation(() => { order.push('motion'); });
    const contact = vi.spyOn(hunt, 'chargeContact').mockImplementation(() => { order.push('contact'); });
    expect(intake.beforeBody('foreign', .1)).toBe(false);
    expect(intake.beforeBody(body.id, .1)).toBe(true); intake.afterBody(body.id, .1);
    expect(order).toEqual(['motion', 'contact']);
    expect(motion).toHaveBeenCalledWith(actor, .1, leadPlayer(host).position); expect(contact).toHaveBeenCalledWith(actor, leadPlayer(host).position);
    actor.stagger(new Vector3(0, 0, 1), 1);
    expect(intake.beforeBody(body.id, .1)).toBe(false); intake.afterBody(body.id, .1); expect(order).toHaveLength(2);
    actor.alive = false; expect(intake.beforeBody(body.id, .1)).toBe(false); intake.afterBody(body.id, .1); expect(order).toHaveLength(2);
    intake.retire(body); expect(intake.beforeBody(body.id, .1)).toBe(false); intake.afterBody(body.id, .1); expect(order).toHaveLength(2);
    const stream = rng.snapshot();
    expect(() => createNativeCreatureRoster(host, { ...rows, bodyPhase: { animateWithin: Infinity, clearWithin: 3 } })).toThrow('ranges');
    expect(rng.snapshot()).toEqual(stream);
  } finally { host.dispose(); }
});

test('native replacement retains the recipe slot, herd/identity order and six spawn draws', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), rng = new Rng(53), control = new Rng(53);
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing real native recipe');
  const order: string[] = [], { hunt, services } = fixtureNativeRoster(host, rng), rows = hunt.herds;
  hunt.addHerd(sample.spec.kind, 8, 8);
  const addHerd = hunt.addHerd.bind(hunt);
  vi.spyOn(hunt, 'addHerd').mockImplementation((kind, x, z) => {
    expect(kind).toBe(sample.spec.kind); expect([x, z]).toEqual([8, 8]); order.push('herd'); return addHerd(kind, x, z);
  });
  vi.spyOn(hunt, 'forget').mockImplementation(actor => {
    expect(host.entities.has(actor.entityId)).toBe(true); order.push(`retire:${actor.entityId}`);
  });
  const intake = createNativeCreatureRoster(host, { specs: [sample.spec],
    variants: new Map([[sample.spec.kind, [{ id: sample.spec.variant, scale: [1, 2] as const }]]]),
    rng, services, hunted: 'every', spawnY: 10, attackTurnCap: 1 });
  try {
    const body: Parameters<typeof intake.arrive>[0] = intake.body('old', sample.spec.kind, sample.spec.variant, 0, { x: 8, z: 8 }, 0);
    intake.arrive(body); const original = body.actor, recipe = body.recipe; order.length = 0;
    const allocate = intake.identities.allocate.bind(intake.identities);
    vi.spyOn(intake.identities, 'allocate').mockImplementation(() => {
      expect(rows[0]?.members).toContain(original); expect(body.actor).toBeNull(); expect(host.entities.has('old')).toBe(false); order.push('allocate'); return allocate();
    });
    const joined = intake.refill(body, { x: 8, z: 8 });
    expect(order).toEqual(['retire:old', 'allocate', 'herd']); expect(rows[1]?.members).toContain(joined); expect(joined).toBe(body.actor);
    expect(body.recipe).toBe(recipe); expect(body.id).toBe('creature:0'); expect(recipe.id).toBe('creature:0');
    expect(rows[0]?.members).toEqual([]); expect(rows[1]?.members).toEqual([body.actor]); expect(body.actor).not.toBe(original);
    const scale = control.range(1, 2); control.next(); const seed = control.next(); control.next(); control.next(); control.next();
    expect([recipe.scale, recipe.seed]).toEqual([scale, seed]); expect(rng.snapshot()).toEqual(control.snapshot());
    const before = rng.snapshot(), actor = body.actor; order.length = 0;
    expect(() => intake.retire({ ...body })).toThrow('Foreign');
    expect(() => intake.refill(body, { x: Infinity, z: 0 })).toThrow('Invalid');
    expect(order).toEqual([]); expect(body.actor).toBe(actor); expect(rng.snapshot()).toEqual(before);
    expect(intake.retireDead('missing')).toBeNull(); expect(intake.retireDead('creature:0')).toBeNull(); expect(body.actor).toBe(actor);
    if (actor === null) throw new Error('Missing replacement actor'); actor.alive = false;
    expect(intake.retireDead('creature:0')).toBe(body); expect(body.actor).toBeNull(); expect(rows[1]?.members).toEqual([]); expect(host.entities.has('creature:0')).toBe(false);
    expect(() => intake.retire(body)).toThrow('Foreign'); expect(rng.snapshot()).toEqual(before);
  } finally { host.dispose(); }
});

test('native continuation resolves real identities and preserves detached ordered state', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), rng = new Rng(71);
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native recipe');
  const hunt = new HuntBrain<HuntBody>({ rng, fight: {}, faunaTuning: () => undefined, species: () => BOAR }, {
    ground: { heightAt: () => 0, normalY: () => 1, trailDistance: () => Infinity, cabinMask: () => 0,
      inChunk: () => true, streamAt: () => null, waterLevel: () => -20, pond: () => null, sea: () => false,
      wetAt: () => false, trees: () => [], treeless: () => true, terrain: () => true, chunkHalf: 16 },
    nav: () => null, reach: () => true, wanderGoal: () => null, unaware: () => false,
    now: () => 0, sound: () => undefined, charge: () => undefined,
  }, leadPlayer(host).position);
  const services = admitNativeRosterServices(host, 'fixture.roster', hunt);
  const intake = createNativeCreatureRoster(host, { specs: [sample.spec], variants: new Map(), rng, services, hunted: 'every', spawnY: 10 });
  try {
    const body = intake.body('first', sample.spec.kind, sample.spec.variant, 0, { x: 2, z: 3 }, 0, [1, 1]);
    const actor = intake.arrive(body); intake.remember(body);
    const memory = hunt.memory(actor);
    if (memory === undefined) throw new Error('Missing adopted memory');
    memory.path = [new Vector3(2, 0, 3)];
    const manager = new NativeManager(host, hunt, rng, { limit: 2, sightSlots: 2, initialSight: null });
    manager.advance(0.125); manager.sight[1] = true; manager.noise.prev.set(4, 0, 8);
    const saved = manager.snapshot([null, 'first'], ['first']), stream = rng.snapshot();
    expect(saved.memories[0]).toBeNull(); expect(saved.memories[1]?.['path']).toEqual([[2, 0, 3]]);
    memory.path[0]?.set(8, 0, 9); rng.next(); manager.advance(0.25); manager.noise.prev.set(0, 0, 0);
    manager.restore(saved, [null, 'first'], ['first']);
    expect(manager.snapshot([null, 'first'], ['first'])).toEqual(saved);
    expect(rng.snapshot()).toEqual(stream); expect(memory.path[0]).toEqual(new Vector3(2, 0, 3));
    expect(() => manager.restore(saved, [null, 'foreign'], ['foreign'])).toThrow('Foreign');
    expect(() => manager.restore(saved, ['first', 'first'], ['first'])).toThrow('roster');
    expect(() => manager.restore(saved, [null, 'first'], ['missing'])).toThrow('roster');
    expect(manager.snapshot([null, 'first'], ['first'])).toEqual(saved); expect(rng.snapshot()).toEqual(stream);
    expect([...host.entities.keys()]).toEqual(['first']);
  } finally { host.dispose(); }
});

test('native admission attaches existing actors and preserves release ordering', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), rng = new Rng(37), before = rng.snapshot();
  const recipe = SIM_LEVEL.entities[0]; if (recipe === undefined) throw new Error('Missing native recipe');
  const observed: unknown[] = [], { hunt, services } = fixtureNativeRoster(host, rng);
  hunt.addHerd(recipe.spec.kind, 0, 0);
  const members = hunt.herds[0]?.members;
  vi.spyOn(hunt, 'forget').mockImplementation(actor => { observed.push([host.entities.has(actor.entityId), actor.alive, actor.position.y, actor.hidden]); });
  const intake = createNativeCreatureRoster(host, { specs: [recipe.spec], variants: new Map(), rng, services, hunted: 'every', spawnY: 10 });
  try {
    const actor = host.spawn({ ...recipe, id: 'creature:7' });
    const body = intake.body(actor.entityId, actor.kind, actor.variant, 0, actor.position, actor.yaw, [actor.scale, actor.scale], actor);
    intake.attach(body, actor);
    expect([...host.entities.keys()]).toEqual(['creature:7']); expect(members).toEqual([actor]); expect(body.actor).toBe(actor);
    expect(() => intake.attach(body, actor)).toThrow('materialized');
    expect(() => intake.attach({ ...body, id: 'foreign' }, actor)).toThrow('Foreign');
    expect(rng.snapshot()).toEqual(before);
    intake.retire(body, { membership: 'retain', native: 'before', final: { alive: false, hidden: true, y: -10000 } });
    expect(observed).toEqual([[false, false, -10000, true]]); expect(members).toEqual([actor]);
    expect(intake.identities.identity(actor.entityId)?.state).toBe('retired'); expect(intake.byId.size).toBe(0);
    expect(body.actor).toBeNull(); expect(rng.snapshot()).toEqual(before);
  } finally { host.dispose(); }
});

test('AS admission preserves placement draws and ordered herd recipes', () => {
  const program = admissionPage(), rng = new Rng(2907), oracle = new Rng(2907);
  expect(program.project('begin', {})).toEqual({ attempts: 40 });
  for (let i = 0; i < 80; i++) {
    const angle = oracle.range(0, Math.PI * 2), distance = Math.sqrt(oracle.next()) * 8;
    expect(program.project('spot', { x: 31, z: -42, radius: 8 }, rng)).toEqual({ x: 31 + Math.cos(angle) * distance, z: -42 + Math.sin(angle) * distance });
    expect(program.project('yaw', {}, rng)).toEqual({ yaw: oracle.range(0, Math.PI * 2) });
    expect(rng.snapshot()).toEqual(oracle.snapshot());
  }
  const observation = { x: 235, z: -235, normal: .78, height: 1, water: .7, wet: 0, clash: 0 };
  expect(program.project('accept', observation)).toEqual({ accept: 1 });
  for (const refused of [{ x: 235.00001 }, { normal: .7799 }, { height: .999 }, { wet: 1 }, { clash: 1 }])
    expect(program.project('accept', { ...observation, ...refused })).toEqual({ accept: 0 });
  const params = { coats: 12, mares: 11, foals: 3, stallion: 1 }, start = oracle.int(0, 11);
  expect(program.project('herdStart', params, rng)).toEqual({ start, count: 15 });
  for (let index = 0; index < 15; index++) {
    const plan = program.project('herdMember', { ...params, start, index });
    expect(plan).toEqual(index < 11 ? { variant: (start + index) % 12, radius: 11, place: 0 }
      : index < 14 ? { variant: 12 + (index - 11) % 2, radius: 3, place: 1, mother: index - 11 }
        : { variant: 14, radius: 4, place: 2, x: 16, z: 4, yaw: 0 });
  }
  expect(program.project('foal', {}, rng)).toEqual({ x: oracle.range(-2, 2), z: oracle.range(-2, 2) });
  expect(rng.snapshot()).toEqual(oracle.snapshot());
  expect(program.project('pack', { elite: 1, packs: 2, groups: 7, variants: 5, bodies: 59 })).toEqual({ accept: 1 });
  expect(program.project('pack', { elite: 1, packs: 2, groups: 7, variants: 5, bodies: 60 })).toEqual({ accept: 0 });
  expect(program.project('bond', { x: 250, z: -250, bonds: 0, elite: 1 })).toEqual({ accept: 1, scale: 1.3 });
  expect(program.project('bond', { x: 0, z: 0, bonds: 1, elite: 0 })).toEqual({ accept: 0, scale: 0 });
});


test('native roster rows refuse fabricated, foreign and disposed services before effects', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), other = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), rng = new Rng(19);
  const { hunt, services } = fixtureNativeRoster(host, rng), before = rng.snapshot();
  const rows = { specs: [], variants: new Map(), rng, services, hunted: 'every' as const, spawnY: 0 };
  try {
    const fake = { herds: [], adopt: () => { rng.next(); }, forget: () => undefined, addHerd: () => 0 };
    expect(() => { Reflect.apply(admitNativeRosterServices, undefined, [host, 'fabricated', fake]); }).toThrow('built-in');
    expect(() => { Reflect.apply(admitNativeRosterServices, undefined, [host, 'fabricated.pose', hunt, { binding: fake }]); }).toThrow('built-in');
    expect(() => admitNativeRosterServices(host, services, hunt)).toThrow('Duplicate');
    expect(() => createNativeCreatureRoster(other, rows)).toThrow('Missing');
    expect(() => createNativeCreatureRoster(host, { ...rows, services: 'missing' })).toThrow('Missing');
    expect(host.entities.size).toBe(0); expect(rng.snapshot()).toEqual(before);
    host.dispose();
    expect(() => createNativeCreatureRoster(host, rows)).toThrow('Missing');
    expect(() => admitNativeRosterServices(host, 'disposed', hunt)).toThrow('built-in');
  } finally { if (!host.scope.disposed) host.dispose(); other.dispose(); }
});


test('AS sheepdog retains guard, fetch and rest behaviour on the 10 Hz decision step', () => {
  const program = admissionPage(), rng = new Rng(241), oracle = new Rng(241);
  const observed = { px: 0, py: 0, pz: 0, cx: 0, cz: 0, dt: 0.1, bark: 0, rest: 0,
    wolf: 1, distance: 20, wx: 20, wy: 2, wz: 0, straggler: 0, sx: 0, sy: 0, sz: 0,
    playerX: 2, playerY: 0, playerZ: 0 };
  expect(program.project('dog', observed, rng)).toMatchObject({ state: 1, x: 10, z: 0, path: 0.8,
    speed: 7.5, lookX: 20, lookY: 2, snarl: 1, low: 0.4, emit: 1, bark: 0.5 + oracle.next() * 0.6 });
  expect(rng.snapshot()).toEqual(oracle.snapshot());
  const before = rng.snapshot();
  expect(program.project('dog', { ...observed, wolf: 0, straggler: 1, sx: 20 }, rng)).toMatchObject({
    state: 2, x: 23.5, z: 0, path: 1, speed: 7.5, snarl: 0, low: 0.8, emit: 0 });
  expect(program.project('dog', { ...observed, wolf: 0, rest: 4 }, rng)).toMatchObject({
    state: 0, speed: 0, path: -1, turn: 2, rest: 3.9, emit: 0 });
  expect(program.project('dog', { ...observed, wolf: 0 }, rng)).toMatchObject({
    state: 3, speed: 3.4, path: 2, turn: 3, rest: -0.1, emit: 0 });
  expect(rng.snapshot()).toEqual(before);
  expect(program.project('restorePack', { herd: 4, expected: 4, variants: 5, elite: 1 })).toEqual({ accept: 1 });
  expect(program.project('restorePack', { herd: 4, expected: 4, variants: 3, elite: 1 })).toEqual({ accept: 0 });
  expect(program.project('restoreBody', { id: 35, initial: 35, nextId: 40, retired: 0 })).toEqual({ accept: 1 });
  expect(program.project('restoreBody', { id: 40, initial: 35, nextId: 40, retired: 0 })).toEqual({ accept: 0 });
});

test('pasture shepherd patrol stays within its unchanged decision fuel on the first native tick', () => {
  const scope=new Scope('original-shepherd-programme');lendNalatiPasture(scope);
  const author = ReturnProgram.page(pasture,scope), random = new Rng(53);
  try {
  const input = { raidT: 163.2241375628859, pendingT: 0, raiding: 0, raids: 0, taken: 0, drivenOff: 0, cracks: 0, cracksNow: 0,
    spawned: 0, crackCd: 0, restT: 0, patrolA: 0, dt: 0.1, px: -108, pz: 228, yaw: -2.498091544796509,
    cx: -119.28424587249756, cz: 212.73528823852538, wolf: 0, wx: 0, wz: 0, time: 0.1, seed: 0.3340211238246411 };
  for (let tick = 0; tick < 100; tick++) {
    const output = author.project('shepherd', { ...input, time: tick / 10 }, random);
    expect(Object.values(output).every(Number.isFinite)).toBe(true);
    expect(output['speed']).toBe(1.8);
    expect(Math.abs(output['yaw'] ?? 4)).toBeLessThanOrEqual(Math.PI);
  }
  }finally{scope.dispose();}
});
