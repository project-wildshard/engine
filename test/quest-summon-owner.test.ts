// ONE-FORMAT OF19d: Dunes rev 5's quest page summons the Matriarch, whom the plan's owner row names (her flag, fact and coins)
// and a declared boss encounter fights. The page binds no fight for her, so the summon is the server's; the page threw
// "Quest summon requires its actual encounter" and never entered (wildshard prepare on rev 5, a5de2fff5).
import { expect, test } from 'vitest';
import { questSummonOwner } from '../src/client/game/shardfile/clientQuestPage';

const encounters = [{ entity: 'sunscar.matriarch' }];

test('an owner-named declared encounter with no page fight is summoned on the wire', () => {
  expect(questSummonOwner('sunscar.matriarch', { owner: 'sunscar.matriarch', fight: false, encounters })).toBe('wire');
});

test('a declared encounter the owner row does not name stays on the wire, and the keeper fight stays the page\'s', () => {
  expect(questSummonOwner('sunscar.matriarch', { owner: undefined, fight: false, encounters })).toBe('wire');
  expect(questSummonOwner('keeper.boss', { owner: 'keeper.boss', fight: true, encounters: [] })).toBe('page');
});

test('a summon of nothing refuses', () => {
  expect(() => questSummonOwner('nobody', { owner: 'keeper.boss', fight: true, encounters })).toThrow('Quest summon requires its actual encounter');
  expect(() => questSummonOwner('keeper.boss', { owner: 'keeper.boss', fight: false, encounters: [] })).toThrow('Quest summon requires its actual encounter');
});
