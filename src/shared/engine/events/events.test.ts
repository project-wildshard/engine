import { expect, test } from 'vitest';
import { Events } from './events';
import { Scope } from '../app/scope';
import { enteredOwner, withOwner } from '../app/ownership';

test('unanswered asks preserve input identity and the independent crouch refusal', () => {
  const events = new Events(), request = { want: true, via: 'toggle' as const };
  expect(events.ask('player.traversal', false)).toBe(false);
  const first = events.ask('player.crouch', request), second = events.ask('player.crouch', request);
  expect(first).toEqual({ allowed: false, latched: false });
  expect(second).toEqual(first);
  expect(first).not.toBe(second);
  expect(first).not.toBe(request);
});

test('a single answerer keeps its owner and newly registered answers wait for the next ask', () => {
  const events = new Events(), first = new Scope('first-answer'), added = new Scope('added-answer'), calls: string[] = [];
  let installed = false;
  events.answer('player.traversal', value => {
    expect(enteredOwner()).toBe(first); calls.push('first');
    if (!installed) {
      installed = true;
      events.answer('player.traversal', next => { calls.push('added'); return next === false; }, added);
    }
    return value === false;
  }, first);
  try {
    expect(events.ask('player.traversal', false)).toBe(true);
    expect(calls).toEqual(['first']); calls.length = 0;
    expect(events.ask('player.traversal', false)).toBe(false);
    expect(calls).toEqual(['first', 'added']);
  } finally { first.dispose(); added.dispose(); }
});

test('a self-retiring answer can replace itself and recursively ask without replacing the outer result', () => {
  const events = new Events(), first = new Scope('retiring-answer'), replacement = new Scope('replacement-answer');
  const answer = { allowed: true, latched: true };
  events.answer('player.crouch', request => {
    first.dispose();
    events.answer('player.crouch', () => ({ allowed: false, latched: true }), replacement);
    expect(events.ask('player.crouch', request)).toEqual({ allowed: false, latched: true });
    return answer;
  }, first);
  try {
    expect(events.ask('player.crouch', { want: true, via: 'hold' })).toBe(answer);
    expect(events.ask('player.crouch', { want: false, via: 'toggle' })).toEqual({ allowed: false, latched: true });
  } finally { first.dispose(); replacement.dispose(); }
});

test('multiple answerers retain snapshot order, active removal and owner restoration after a throw', () => {
  const events = new Events(), owner = new Scope('ask-parent'), first = owner.child('first'), removed = owner.child('removed');
  const last = owner.child('last'), added = owner.child('added'), calls: string[] = [];
  let installed = false;
  events.answer('player.traversal', value => {
    calls.push('first'); removed.dispose();
    if (!installed) { installed = true; events.answer('player.traversal', next => { calls.push('added'); return next === false; }, added, { order: -1 }); }
    return value === false;
  }, first, { order: 0 });
  events.answer('player.traversal', () => { calls.push('removed'); return false; }, removed, { order: 1 });
  events.answer('player.traversal', value => { calls.push('last'); return Boolean(value); }, last, { order: 2 });
  try {
    expect(events.ask('player.traversal', false)).toBe(true);
    expect(calls).toEqual(['first', 'last']); calls.length = 0;
    expect(events.ask('player.traversal', false)).toBe(false);
    expect(calls).toEqual(['added', 'first', 'last']);
    first.dispose(); last.dispose(); added.dispose();
    const throwing = owner.child('throwing');
    events.answer('player.traversal', () => { expect(enteredOwner()).toBe(throwing); throw new Error('answer failed'); }, throwing);
    withOwner(owner, () => {
      expect(() => events.ask('player.traversal', false)).toThrow('answer failed');
      expect(enteredOwner()).toBe(owner);
    });
  } finally { owner.dispose(); }
});
