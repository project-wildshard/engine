import { expect, test } from 'vitest';
import { FAILURES } from '../src/client/app/failScreens';

// A13 / meta MMO-FAILURE-MODES-PLAN FM1b: the prototypes are the catalogue the wiring rows (FM4 to FM8b) build to, so each id is the
// `data-failmode` a proof looks for, and every banner or notice a player can act under has its blocked-action sibling.
test('every failure screen id is unique', () => {
  const ids = FAILURES.map(failure => failure.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('every blocked-action sibling is a hold card over a banner or notice, right after it', () => {
  const siblings = FAILURES.filter(failure => failure.pair !== undefined);
  expect(siblings.map(failure => failure.id).sort()).toEqual(['background-short-blocked', 'deploy-blocked', 'drop-blocked', 'half-open-blocked', 'reset-blocked',
    'restart-blocked', 'resuming-blocked', 'save-slow-blocked', 'voice-failed-blocked']);
  for (const sibling of siblings) {
    const index = FAILURES.indexOf(sibling), under = FAILURES[index - 1];
    expect(sibling.id).toBe(`${String(sibling.pair)}-blocked`);
    expect(under?.id).toBe(sibling.pair);
    expect(['strip', 'chip', 'tip']).toContain(under?.screen.kind);
    expect(sibling.screen.kind).toBe('card');
    expect(sibling.screen.blocked).toBeTruthy();
    // a hold card always says what happens by itself, and shows live progress
    expect(sibling.screen.auto).toBeTruthy();
    expect(sibling.screen.facts?.some(fact => fact.includes('{n}'))).toBe(true);
    expect(sibling.screen.countdown).toBeGreaterThan(0);
    // a banner that counts down shares the card's clock when drawn under it (showFailScreen), so only the card's is needed
    if (sibling.screen.hold !== undefined) expect(sibling.screen.hold.left).toBeLessThanOrEqual(sibling.screen.hold.of);
  }
});

test('the plan\'s added failures 37 to 46 have their screens', () => {
  const ids = new Set(FAILURES.map(failure => failure.id));
  for (const id of ['release-404', 'captive-portal', 'release-unsigned', 'refused', 'banned', 'storage-full', 'staging', 'tls', 'packs-5xx', 'background-long']) expect(ids.has(id)).toBe(true);
});
