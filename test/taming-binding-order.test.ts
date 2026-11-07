import type {TamingHorse} from '../src/shared/game/riding/bindingTypes';
import {expect,test} from 'vitest';
import {tamingRig as fixture} from './fixtures/tamingServices';

test('native mount refusal precedes player pose, entropy and taming continuation changes', () => {
  const f = fixture(), wire = f.binding.snapshot();
  f.binding.startBreaking();
  expect(f.events).toEqual(['mount:wild:true']);
  expect(f.opts.player.yaw).toBe(2); expect(f.opts.player.pitch).toBe(.4);
  expect(f.binding.snapshot()).toBe(wire);
  f.allowMount(); f.events.length = 0; f.binding.startBreaking();
  expect(f.events).toEqual(['mount:wild:true', 'yaw', 'pitch', 'random', 'random', 'random', 'breaking:true', 'notice:Start']);
  expect(f.opts.player.yaw).toBe(.7 - Math.PI); expect(f.opts.player.pitch).toBe(-.1);
  expect(f.binding.phase).toBe('breaking');
});

test('due sampling draws three values even when the mounted actor was just lost', () => {
  const f = fixture(); f.allowMount(); f.binding.startBreaking(); f.events.length = 0;
  f.binding.update(.04);
  expect(f.events).toEqual([]);
  f.loseMount(); f.binding.update(.06);
  expect(f.events).toEqual(['random', 'random', 'random', 'breaking:false', 'dismount:true', 'hurt:10', 'trust:-40', 'lead', 'notice:Thrown']);
  expect(f.binding.phase).toBe('wild');
});

test('a native mount callback can query taming without replacing the outer action loans', () => {
  const expected=fixture(),actual=fixture();expected.allowMount();actual.allowMount();
  const mount=actual.opts.mount.mount;let queries=0;
  Object.defineProperty(actual.opts.mount,'mount',{value:(actor:TamingHorse,breaking?:boolean)=>{
    const before=actual.binding.snapshot();actual.binding.canTame(actor);queries++;
    expect(actual.binding.snapshot()).toBe(before);
    return mount(actor,breaking);
  }});
  expected.binding.startBreaking();actual.binding.startBreaking();
  expect(queries).toBe(1);expect(actual.events).toEqual(expected.events);
  expect(actual.binding.snapshot()).toBe(expected.binding.snapshot());
  for(const dt of [.04,.06,.1]){expected.binding.update(dt);actual.binding.update(dt);}
  expect(actual.events).toEqual(expected.events);expect(actual.binding.snapshot()).toBe(expected.binding.snapshot());
});

test('a bond replaces the original companion in native allocation and publication order', () => {
  const f = fixture('bond'); f.allowMount(); f.binding.startBreaking();
  let previous = 0;
  for (let tick = 0; tick < 220 && f.binding.phase === 'breaking'; tick++) {
    const balance = f.binding.view.balance;
    f.hud.lean = Math.max(-1, Math.min(1, balance * 8 + (balance - previous) * 20)); previous = balance;
    f.events.length = 0; f.binding.update(.1);
  }
  expect(f.binding.phase).toBe('bonded'); expect(f.binding.companion?.entityId).toBe('bonded-2');
  const first = f.events.indexOf('breaking:false');
  expect(first).toBeGreaterThanOrEqual(0);
  expect(f.events.slice(first)).toEqual(['breaking:false', 'dismount:false', 'release', 'hide:wild', 'remove:bonded-1', 'retire:bonded-1',
    'spawn:bonded-2', 'add:bonded-2', 'mount:bonded-2:false', 'write:better-bond', 'notice:Better bonded', 'bonded:bonded-2']);
  const wire = f.binding.snapshot(); f.binding.restore(wire, [f.herd.stallion, f.binding.companion].filter((actor): actor is TamingHorse => actor !== null));
  expect(f.binding.snapshot()).toBe(wire);
});
