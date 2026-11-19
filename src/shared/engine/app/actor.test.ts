import { expect, test } from 'vitest';
import { classifyActor, type ActorFacts } from './actor';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
const cases = [
  [{ userAgent: iphone }, { actor: 'human', why: 'unmarked' }],
  [{ userAgent: `${iphone} WildshardAgent/1 (codex-memgates)` }, { actor: 'agent', lane: 'codex-memgates', why: 'user-agent' }],
  [{ userAgent: iphone, header: 'ci-smoke' }, { actor: 'agent', lane: 'ci-smoke', why: 'header' }],
  [{ query: '1' }, { actor: 'agent', why: 'query' }],
  [{ stored: 'mini.test' }, { actor: 'agent', lane: 'mini.test', why: 'stored' }],
  [{ webdriver: true }, { actor: 'agent', why: 'webdriver' }],
  [{ harness: true }, { actor: 'agent', why: 'harness' }],
  [{ doorPass: `pass:demo.123.${'a'.repeat(128)}`, userAgent: iphone }, { actor: 'agent', lane: 'demo', why: 'door-pass' }],
  [{ header: 'unsafe\r\nlane' }, { actor: 'agent', why: 'header' }],
] satisfies readonly [ActorFacts, ReturnType<typeof classifyActor>][];

test.each(cases)('classifies %j', (facts, expected) => {
  expect(classifyActor(facts)).toEqual(expected);
});

test.each(['', 'node', 'curl/8.1', 'undici', 'HeadlessChrome/141', 'Playwright/1.60', 'PhantomJS/2.1'])(
  'recognises automation UA %j', userAgent => {
    expect(classifyActor({ userAgent })).toEqual({ actor: 'agent', why: 'automated-ua' });
  });
