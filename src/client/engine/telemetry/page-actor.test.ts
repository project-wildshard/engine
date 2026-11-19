import { expect, test } from 'vitest';
import { classifyActorTab } from './pageActor';

test('an agent marker persists to later boots in the same tab', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  expect(classifyActorTab('?agent=lane.one&shard=driftwood-isle', storage, {})).toEqual({ actor: 'agent', lane: 'lane.one', why: 'query' });
  expect(classifyActorTab('', storage, { userAgent: 'iPhone Safari' })).toEqual({ actor: 'agent', lane: 'lane.one', why: 'stored' });
  expect(classifyActorTab('', undefined, { userAgent: 'iPhone Safari' })).toEqual({ actor: 'human', why: 'unmarked' });
});

test('accepts a query marker when session storage refuses writes', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('storage blocked'); } };
  expect(classifyActorTab('?agent=1', storage, {})).toEqual({ actor: 'agent', why: 'query' });
});
