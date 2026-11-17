// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { GAME_STRINGS } from '../../shared/game/strings';
import { installShards } from './shard/list';
import { buildTitleDeck, type TitleCard } from './titleDeck';

/** MAIN-SCREEN MS3 (J387: "Not shard select, zone select"; J399: the button is ENTER ZONE): every word the main menu, the zone
 *  deck and the one-zone deep link show a player says zone, never shard. */
const words = (value: unknown): string[] => typeof value === 'string' ? [value]
  : typeof value === 'function' ? [(value as (name: string) => string)('Driftwood Isle')]
  : typeof value === 'object' && value !== null ? Object.values(value).flatMap(words) : [];

test('MS3: the main menu and the deep link say zone, never shard', () => {
  const all = [...words(GAME_STRINGS.mainMenu), ...words(GAME_STRINGS.slugPage), GAME_STRINGS.grid.waitingSelect, GAME_STRINGS.grid.ended];
  expect(all.filter(word => /shard/iu.test(word.replaceAll(/wildshard/giu, '')))).toEqual([]);
  expect([GAME_STRINGS.mainMenu.zoneSelect, GAME_STRINGS.mainMenu.enterZone, GAME_STRINGS.grid.waitingSelect]).toEqual(['ZONE SELECT', 'Enter zone', 'ENTER THROUGH ZONE SELECT']);
});

test('MS3: the deck\'s button reads ENTER ZONE on an open card', () => {
  installShards([]);
  const card: TitleCard = { slug: 'driftwood-isle', name: 'Driftwood Isle', label: 'Island', thumbnail: '', heroPortrait: '', heroLandscape: '' };
  const deck = buildTitleDeck({ cards: [card], active: null, onEnter: () => undefined, onExplore: () => undefined, onSettings: () => undefined });
  document.body.append(deck.root);
  expect(deck.root.querySelector('.ws-menu-play b')?.textContent).toBe('Enter zone');
  expect(deck.root.textContent?.replaceAll(/wildshard/giu, '')).not.toMatch(/enter world|shard/iu);
  deck.dispose(); document.body.replaceChildren();
});
