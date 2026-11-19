import { expect, test } from 'vitest';
import { FIGHT_HOLD_MS, FightMark } from './fightMark';

// J473 (Jake, 2026-11-19 grill): no chat peek in a fight, an open chat closes on a hit, HP only in combat.
test('J473: a fight is a hit taken or landed in the last 8 s, marked on the page; every hit taken moves data-ws-hurt', () => {
  const root = { dataset: {} as Record<string, string | undefined> } as unknown as HTMLElement, fight = new FightMark(root);
  expect(fight.tick(0)).toBe(false);
  fight.hurt(1000);
  expect(root.dataset['wsFight']).toBe(''); expect(root.dataset['wsHurt']).toBe('1');
  expect(fight.tick(1000 + FIGHT_HOLD_MS - 1)).toBe(true);
  expect(fight.tick(1000 + FIGHT_HOLD_MS)).toBe(false);
  expect(root.dataset['wsFight']).toBeUndefined();
  fight.struck(20_000);
  expect(root.dataset['wsFight']).toBe(''); expect(root.dataset['wsHurt']).toBe('1');
  fight.hurt(21_000);
  expect(root.dataset['wsHurt']).toBe('2');
  fight.clear();
  expect(root.dataset['wsFight']).toBeUndefined(); expect(root.dataset['wsHurt']).toBeUndefined();
});
