// @vitest-environment happy-dom
// MOSSGATE-ZONE MZ37 (meta): on staging's Mossgate grid page the card's poll passed at the report, set `offered`, and opened
// nothing. The poll runs in a system callback whose ambient owner was a scope already disposed (the hermit's talk box), and
// the card's UI scope was that scope's child: it mounted no DOM and pushed no layer, so it was never up. The card takes the
// owner its installer gives it, whatever the ambient one is.
import { afterEach, expect, test } from 'vitest';
import { installBrowserScopeEnvironment } from '@wildshard/engine/app/view/scopeEnvironment';
import { Scope } from '@wildshard/engine/app/scope';
import { enterOwner } from '@wildshard/engine/app/ownership';
import { ShardComplete } from './ShardComplete';

const data = { kicker: 'The Lamplighter · done', title: 'Mossgate Hollow', flavour: ['The lamps are lit.'], stats: [], todo: [] };
let card: ShardComplete | null = null;
afterEach(() => { card?.close(); card = null; enterOwner(null); });

test('a card with an owner opens under a disposed ambient owner', () => {
  installBrowserScopeEnvironment();
  document.body.innerHTML = '<div id="hud"></div>';
  const stay = new Scope('stay'), talk = new Scope('talk');
  talk.dispose();
  enterOwner(talk);
  card = new ShardComplete(stay);
  card.open({ ...data }, { keep: () => undefined });
  expect(card.isOpen).toBe(true);
  expect(document.querySelector('.ws-complete')).not.toBeNull();
  stay.dispose();
  expect(card.isOpen).toBe(false);
});

test('without an owner the disposed ambient owner leaves the card shut (the MZ37 miss)', () => {
  installBrowserScopeEnvironment();
  document.body.innerHTML = '<div id="hud"></div>';
  const talk = new Scope('talk');
  talk.dispose();
  enterOwner(talk);
  card = new ShardComplete();
  card.open({ ...data }, { keep: () => undefined });
  expect(card.isOpen).toBe(false);
  expect(document.querySelector('.ws-complete')).toBeNull();
});
