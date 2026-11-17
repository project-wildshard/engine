import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { Scope } from '../src/shared/engine/app/scope';
import { Rng } from '../src/shared/engine/core/rng';
import { sha256 } from '../src/shared/game/plugin/moduleHash';
import { SimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { preflightPlainPerches } from '../src/server/game/shardfile/dataPerchBrains';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { perchFixture } from './fixtures/plain-perch';
import { frozenTitanInline } from './fixtures/frozen/runtimePrograms';
import { lendFrozenReturns, frozenReturnInline } from './fixtures/frozen/returns';

const assets = () => new Map<string, Uint8Array>();

test('actual plain preparation admits original VM bytes without a body phase or random draw', () => {
  const shard = perchFixture(), before = JSON.stringify(shard);
  const project = vi.spyOn(ReturnProgram.prototype, 'project'), random = vi.spyOn(Rng.prototype, 'next');
  try {
    const prepared = preflightPlainPerches(shard, assets());
    expect([...prepared.keys()]).toEqual(['fixture.perch']);
    expect(prepared.get('fixture.perch')?.policy.kind).toBe('fixture.creature');
    expect(project).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
    expect(JSON.stringify(shard)).toBe(before);
  } finally { project.mockRestore(); random.mockRestore(); }
});

const faults = ['bite', 'projectile', 'score', 'height', 'channel', 'bytes', 'abi', 'home', 'return', 'reference'] as const;
for (const fault of faults) test(`default creation and restore refuse ${fault} before installing a host callback`, async () => {
  const shard = perchFixture(), body = shard.creatures.perchBodies?.[0], spawn = shard.creatures.spawns[0];
  if (body === undefined || spawn === undefined) throw new Error('Missing fixture authority');
  if (fault === 'bite') { body.policy.strike = 'missing.bite'; spawn.strike = 'missing.bite'; }
  if (fault === 'projectile') body.projectile.strike = 'missing.throw';
  if (fault === 'score') body.policy.score = 'missing.score';
  if (fault === 'height') body.policy.height = 'missing.height';
  if (fault === 'channel') body.policy.heightChannel = 'missing.channel';
  if (fault === 'bytes') body.program.bytes = 'AGFzbQEAAAA=';
  if (fault === 'abi') {
    const bytes = Uint8Array.from(Buffer.from('AGFzbQEAAAA=', 'base64'));
    body.program.bytes = Buffer.from(bytes).toString('base64');
    body.program.script.module = `blobs/wasm/${sha256(bytes)}.wasm`;
  }
  if (fault === 'home') Reflect.deleteProperty(spawn, 'home');
  if (fault === 'return') body.program.script.on = ['start'];
  if (fault === 'reference') Reflect.deleteProperty(shard.creatures, 'perchBodies');
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const callbacks = vi.spyOn(SimHost.prototype, 'onStep'), random = vi.spyOn(Rng.prototype, 'next');
  try {
    for (const construct of [createShardfileSim, prepareShardfileSimRestore]) {
      expect(() => construct(shard, assets(), { rapier, ground: false })).toThrow(/perch|return/i);
    }
    expect(callbacks).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
  } finally { callbacks.mockRestore(); random.mockRestore(); }
});

test('ABI-2 preflight owns and retires actual admitted memory without executing a projection', () => {
  const scope = new Scope('perch.preflight.proof');
  const project = vi.spyOn(ReturnProgram.prototype, 'project');
  try {
    expect(() => ReturnProgram.preflight(frozenTitanInline.attack, scope)).not.toThrow();
    const reserved = scope.census;
    expect(() => ReturnProgram.preflight(frozenTitanInline.attack, scope)).not.toThrow();
    expect(scope.census).toEqual(reserved);
    const forged = structuredClone(frozenTitanInline.attack);
    forged.v2.bytes = 'AGFzbQEAAAA=';
    expect(() => ReturnProgram.preflight(forged, scope)).toThrow('Shared return declaration changed');
    expect(project).not.toHaveBeenCalled();
  } finally { project.mockRestore(); scope.dispose(); }
  expect(Object.values(scope.census).every(count => count === 0)).toBe(true);
});

test('fresh ABI-2 forgery reaches actual projection hash admission before allocating memory', () => {
  const scope = new Scope('perch.fresh.abi2');
  const forged = structuredClone(frozenTitanInline.attack);
  forged.v2.bytes = 'AGFzbQEAAAA=';
  const before = scope.census;
  try {
    expect(() => ReturnProgram.preflight(forged, scope)).toThrow('Return projection hash mismatch');
    expect(scope.census).toEqual({ ...before, disposers: before.disposers + 1 });
  } finally { scope.dispose(); }
  expect(Object.values(scope.census).every(count => count === 0)).toBe(true);
});

test('a valid parent loan survives partial local assets and unrelated unloaded return rows', () => {
  const scope = lendFrozenReturns(new Scope('perch.parent.partial'));
  const shard = perchFixture(), body = shard.creatures.perchBodies?.[0];
  if (body === undefined) throw new Error('Missing fixture body');
  body.program.bytes = '';
  const artifact = frozenTitanInline.attack.v2.artifact;
  const unrelated = { id: 'unrelated.projection', side: 'sim', module: `blobs/wasm/${artifact.hash}.wasm`, abi: 2,
    lane: artifact.lane, pages: artifact.pages, ioBytes: artifact.ioBytes,
    compilerRevision: artifact.compilerRevision, admissionRevision: artifact.admissionRevision };
  const sections = new Map([['actors/return-scripts', [frozenReturnInline.script, unrelated]]]);
  const local = new Map([[body.program.script.module.slice('blobs/wasm/'.length, -'.wasm'.length),
    Uint8Array.from(Buffer.from(frozenReturnInline.bytes, 'base64'))]]);
  const before = scope.census;
  try {
    expect(preflightPlainPerches(shard, local, { scope, sections }).size).toBe(1);
    expect(preflightPlainPerches(shard, assets(), { scope, sections }).size).toBe(1);
    expect(scope.census).toEqual(before);
  } finally { scope.dispose(); }
});

test('the real whole-host module cap includes decision modules beside the perch VM', () => {
  const shard = perchFixture();
  const bytes = Uint8Array.from(Buffer.from(frozenReturnInline.bytes, 'base64'));
  const scripts = parseDecisionScripts(Array.from({ length: 9 }, (_, index) => {
    const binary = new Uint8Array([...bytes, 0, 2, 1, 65 + index]);
    return { ...frozenReturnInline.script, id: `other.${index}`, module: `blobs/wasm/${sha256(binary)}.wasm` };
  }));
  expect(() => preflightPlainPerches(shard, assets(), { sections: new Map([['sim/scripts', scripts]]) })).toThrow('perch whole-host instance cap');
});

test('raw native bytes use the real parent loan and leave its scope census unchanged', () => {
  const scope = lendFrozenReturns(new Scope('perch.raw.preflight'));
  const shard = perchFixture(), body = shard.creatures.perchBodies?.[0];
  if (body === undefined) throw new Error('Missing fixture body');
  body.program.bytes = '';
  const before = scope.census;
  try {
    expect(preflightPlainPerches(shard, assets(), { scope }).size).toBe(1);
    expect(scope.census).toEqual(before);
    expect(() => preflightPlainPerches(shard, assets())).toThrow('raw return module loan');
  } finally { scope.dispose(); }
});

test('the actual consumer uses the admitted reservation and requests real projected values', () => {
  const scope = new Scope('perch.preflight.consumer');
  try {
    ReturnProgram.preflight(frozenTitanInline.attack, scope);
    const program = ReturnProgram.page(frozenTitanInline.attack, scope);
    expect(program.project('bossClamp', { fullHp: 20, share: 0.5 })).toEqual({ hp: 10 });
  } finally { scope.dispose(); }
  expect(Object.values(scope.census).every(count => count === 0)).toBe(true);
});

test('conflicting shared return declarations refuse and retire the entire preparation scope', () => {
  const shard = perchFixture(), first = shard.creatures.perchBodies?.[0];
  if (first === undefined) throw new Error('Missing fixture body');
  const second = structuredClone(first); second.id = 'fixture.other'; second.program.script.id = 'fixture.conflict';
  shard.creatures.perchBodies?.push(second);
  const scope = new Scope('perch.conflicting.preparation'), before = scope.census;
  try {
    expect(() => preflightPlainPerches(shard, assets(), { scope })).toThrow('Shared return declaration changed');
    expect(scope.census).toEqual(before);
  } finally { scope.dispose(); }
});
