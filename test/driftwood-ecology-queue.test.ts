import {Scope} from '../src/shared/engine/app/scope';
import {lendDriftwoodReturns} from './fixtures/driftwood-return-modules';
import { afterEach, expect, test } from 'vitest';
import { RespawnQueue } from '../src/shared/game/population/respawn';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { RETURN_PROGRAM } from './fixtures/driftwood-guest-programs';
import { Rng } from '../src/shared/engine/core/rng';
import { setTerrainHeight } from '../src/shared/engine/world/terrainHeight';
import { compileDecisionScripts } from '../src/sharddev/buildDecisionScripts';

const owners:Scope[]=[];afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();});
function returns():ReturnProgram {const owner=lendDriftwoodReturns(new Scope('return fixture'));owners.push(owner);return ReturnProgram.page(RETURN_PROGRAM,owner);}

test('respawns retain rolled delays, night and distance gates, reverse order and entry identity', () => {
  const queue = new RespawnQueue({ crab: { delay: { min: 2, max: 6 } }, sailor: { delay: { min: 1, max: 1 }, night: true } }, 60);
  expect(queue.add('captain', undefined, -1, 0, 0, 0, .5)).toBeNull();
  expect(queue.accepts('captain')).toBe(false);
  const crab = queue.add('crab', 'big', 3, 0, 0, 10, .5), sailor = queue.add('sailor', undefined, -1, 0, 0, 10, .5);
  expect(queue.take(10, 100, 0, 1)).toEqual([]);
  expect(queue.take(20, 0, 0, 1)).toEqual([]);
  expect(queue.take(12, 100, 0, .49)).toEqual([]);
  const due = queue.take(14, 60, 0, .5);
  expect(due).toEqual([sailor, crab]);
  expect(due[0]).toBe(sailor); expect(due[1]).toBe(crab);
  expect(crab).toMatchObject({ due: 14, variant: 'big', herd: 3 });
  expect(queue.pending).toEqual([]);
  expect(queue.take(20, 100, 0, 1)).toBe(due);
});

test('the native bound refuses atomically while the page retains fresh, uncapped results', () => {
  const queue = new RespawnQueue({ crab: { delay: { min: 0, max: 0 } } }, 60);
  for (let i = 0; i < 257; i++) queue.add('crab', undefined, i, 0, 0, 0, .5);
  const pending = [...queue.pending];
  expect(() => queue.take(1, 100, 0, 1)).toThrow('exceeds its native bound');
  expect(queue.pending).toEqual(pending);
  const page = new RespawnQueue({ crab: { delay: { min: 0, max: 0 } } }, 60, { order: 'reverse', limit: null, result: 'fresh' });
  page.pending.push(...pending);
  const due = page.take(1, 100, 0, 1);
  expect(due).toEqual(pending.reverse());
  expect(page.pending).toEqual([]);
  const later = page.take(2, 100, 0, 1);
  expect(later).not.toBe(due); expect(later).toEqual([]);
  expect(due).not.toEqual([]);
});

test('forward traversal removes adjacent due entries and retains ineligible entries in place', () => {
  const queue = new RespawnQueue({ crab: { delay: { min: 0, max: 0 } } }, 60,
    { order: 'forward', limit: 4, result: 'fresh' });
  const near = queue.add('crab', undefined, 0, 0, 0, 0, .5);
  const first = queue.add('crab', undefined, 1, 100, 0, 0, .5);
  const second = queue.add('crab', undefined, 2, 120, 0, 0, .5);
  expect(queue.take(1, 0, 0, 1)).toEqual([first, second]);
  expect(queue.pending).toEqual([near]);
});

test('v1 returns preserve queue identity, exact boundary gates and fixed-delay draws', () => {
  const script = returns(), rng = new Rng(42), control = new Rng(42);
  const queue = new RespawnQueue({ shorebird: { delay: { min: 2, max: 6 } }, otter: { delay: { min: 1, max: 1 }, night: true } }, 60, undefined, script);
  const first = queue.add('shorebird', 'grey', 3, 0, 0, 10, rng.next());
  expect(first?.due).toBe(10 + 2 + 4 * control.next());
  const second = queue.add('otter', undefined, -1, 0, 0, 10, rng.next()); control.next();
  expect(second?.due).toBe(11); expect(rng.snapshot()).toEqual(control.snapshot());
  expect(queue.take(12, 59.999, 0, 1)).toEqual([]);
  expect(queue.take(12, 60, 0, .49)).not.toContain(second);
  const due = queue.take(20, 60, 0, .5);
  expect(due[0]).toBe(second); expect(due).toContain(first);
});

test('v1 placement retries preserve spawn-stream order and saved queue objects', () => {
  const rng = new Rng(91), control = new Rng(91), queue = new RespawnQueue({ otter: { delay: { min: 0, max: 0 } } }, 0, undefined, returns());
  const entry = queue.add('otter', 'brown', 2, 10, 20, 0, .5);
  if (entry === null) throw new Error('Missing return entry');
  try {
    setTerrainHeight(() => -10);
    queue.take(1, 0, 0, 1);
    expect(queue.place(entry, 1, 0, false, rng)).toBeNull();
    for (let i = 0; i < 12; i++) control.next();
    expect(rng.snapshot()).toEqual(control.snapshot()); expect(queue.pending[0]).toBe(entry); expect(entry.due).toBe(61);
    const saved = structuredClone(queue.pending);
    queue.pending.length = 0; queue.pending.push(...saved);
    setTerrainHeight(() => 2);
    const next = queue.take(61, 0, 0, 1)[0]; if (next === undefined) throw new Error('Missing restored return');
    const angle = control.next() * Math.PI * 2, radius = 1 + control.next() * 4;
    expect(queue.place(next, 61, 0, false, rng)).toEqual({ x: 10 + Math.cos(angle) * radius, z: 20 + Math.sin(angle) * radius });
    expect(rng.snapshot()).toEqual(control.snapshot());
    expect(queue.place(next, 62, 0, true, rng)).toEqual({ x: 10, z: 20 });
    expect(rng.snapshot()).toEqual(control.snapshot());
  } finally { setTerrainHeight(() => 0); }
});

test('independent salt-marsh projection refuses atomically after borrowing a draw', async () => {
  const declaration = { ...RETURN_PROGRAM.script, id: 'saltmarsh.returns', source: 'behaviour/marsh.as' };
  const built = await compileDecisionScripts([declaration], {
    fields: new Map(Object.values(declaration.fields).sort().map((name, i) => [name, i + 1])),
    channels: new Map(Object.values(declaration.channels).sort().map((name, i) => [name, i + 1])),
    signals: new Map(Object.values(declaration.signals).sort().map((name, i) => [name, i + 1])),
  }, new Map([['behaviour/marsh.as', "import { Read, Do, Channel, Signal } from './generated/saltmarshReturns';\n@inline export function onSignal(signal:i32,value:f64,source:i32):void { const draw=Read.random(); if(signal==Signal.schedule){Do.channel(Channel.due,7+draw);return;} Do.channel(Channel.x,draw); unreachable(); }"]]), { asLineCeiling: 10 });
  const script = built.rows[0], blob = built.blobs[0]; if (script === undefined || blob === undefined) throw new Error('Missing fixture guest');
  expect(() => ReturnProgram.page({ script: { ...script, module: `blobs/wasm/${'0'.repeat(64)}.wasm` }, bytes: btoa(String.fromCodePoint(...blob.bytes)) })).toThrow('Return module hash mismatch');
  const program = ReturnProgram.page({ script, bytes: btoa(String.fromCodePoint(...blob.bytes)) }), rng = new Rng(13), control = new Rng(13);
  expect(program.project('schedule', {}, rng)).toEqual({ due: 7 + control.next() });
  expect(rng.snapshot()).toEqual(control.snapshot());
  const before = rng.snapshot();
  expect(() => program.project('place', {}, rng)).toThrow(); expect(rng.snapshot()).toEqual(before);
  expect(() => program.project('not-declared', {}, rng)).toThrow('Invalid return request');
  expect(rng.snapshot()).toEqual(before);
});
