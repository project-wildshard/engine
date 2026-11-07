import {Scope} from '../src/shared/engine/app/scope';
import {lendNalatiRiding,ridingWitnessBytes} from './fixtures/nalati-return-modules';
import { expect, test } from 'vitest';
import { DecisionModule } from '../src/shared/engine/script/decisionModule';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { NALATI_RIDING_PROGRAMS as programs } from './fixtures/nalati-riding';

// iOS JSC runs a synchronous full GC for each new WebAssembly.Memory past its fast-memory cap (40-80 ms per return
// program on a Nalati entry). Stateless return programs take turns in one memory per page count instead.
test('return programs share one memory per page count and answer exactly as alone', () => {
  const scopes=Array.from({length:4},()=>new Scope('shared-memory'));
  const owners=scopes.map(scope=>{lendNalatiRiding(scope);return scope;});
  try{
  const approach=ReturnProgram.page(programs.approach,owners[0]);
  const select = (): Readonly<Record<string, number>> => approach.project('select', { count: 2, px: 0, py: 0, pz: 1, bonded: 1, argymaq: 0 }, undefined,
    [{ x: 0, y: 0, z: 0, alive: 1, argymaq: 0 }, { x: 0, y: 0, z: 10, alive: 1, argymaq: 1 }]);
  const alone = select();
  // Each later module instantiates into the same memory, over the first one's bytes.
  const others = [ReturnProgram.page(programs.breaking,owners[1]), ReturnProgram.page(programs.riding,owners[2]), ReturnProgram.page(programs.approach,owners[3])];
  for(const other of others)expect(other).not.toBe(approach);
  expect(select()).toEqual(alone);
  expect(select()['index']).toBe(1);
  const trust = approach.project('approach', { scale: 1, dt: .1, distance: 2, beaten: 0, mounted: 0, speed: 0, dot: 0, lookT: 0, offer: 1, alert: 0, trust: 99, crouched: 1, downwind: 1, strength: 1, flee: 0 });
  expect(trust['trust']).toBe(1.5); expect(trust['radius']).toBe(3.6);
  const twin = others[2];
  if (twin === undefined) throw new Error('Missing second approach program');
  expect(twin.project('event', { x: 0, z: 0, cx: 0, cz: 0, px: 0, pz: 0, shot: 1, alert: 0 })).toEqual({ trust: -30, alert: 100 });
  expect(select()).toEqual(alone);
  }finally{for(const scope of scopes)scope.dispose();}
});

test('stateless decision modules take turns in one memory; stateful modules keep their own', () => {
  const bytes = (row: { bytes: string }): Uint8Array => Uint8Array.from(atob(row.bytes), byte => byte.codePointAt(0) ?? 0);
  const ports = { read: () => 0, list: () => 0 };
  const legacy=structuredClone([programs.approach,programs.breaking]);
  for(const row of legacy)row.bytes=Buffer.from(ridingWitnessBytes).toString('base64');
  const [a, b] = legacy.map(row => new DecisionModule(bytes(row), [0, 0], ports, true));
  const [c, d] = legacy.map(row => new DecisionModule(bytes(row), [0, 0], ports));
  expect(a?.memory).toBe(b?.memory);
  expect(c?.memory).not.toBe(d?.memory);
  expect(c?.memory).not.toBe(a?.memory);
});
