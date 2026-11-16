// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { parse } from 'valibot';
import { JournalRowSchema } from '@wildshard/format/compendiumRows';
import { Scope } from '../src/shared/engine/app/scope';
import { emptyShardfile } from '../src/shared/host/author';
import { declaredCompendium } from '../src/shared/game/shard/declaredRows';
import { CompendiumState } from '../src/shared/game/compendium/state';
import { compendiumFinds } from '../src/shared/game/compendium/finds';
import { renderFinds } from '../src/client/game/bag/bag';

test.each([undefined, 'currentColor'] as const)('a declared trophy image with tint %s reaches the real sticker DOM and pick behavior', tint => {
  const image = '/images/moon.png?label="quoted"', hash = 'a'.repeat(64), scope = new Scope('custom-find-image');
  const row = parse(JournalRowSchema, { kind: 'journal', id: 'journal.fixture', chunkId: 'icon-fixture', className: 'journal', title: 'Icons',
    tabs: [{ id: 'beasts', label: 'Beasts' }], stamp: { place: 'Seen', default: 'Taken' }, icons: [{ image: hash, ...(tint === undefined ? {} : { tint }) }], stats: { place: [], default: [] },
    entries: [{ id: 'moon.trophy', kind: 'species', tab: 'beasts', name: 'Moon trophy', notes: '', plate: { sketch: hash } }] });
  const source = emptyShardfile({ slug: 'icon-fixture', name: 'Icons', author: 'Test', revision: 1, seed: 1 });
  const state = new CompendiumState(declaredCompendium(row, source.rows, source.identity.slug, () => image)), picked = vi.fn();
  state.take('moon.trophy');
  const panel = document.createElement('div');
  try {
    renderFinds(panel, compendiumFinds(state, picked), scope);
    const sticker = panel.querySelector<HTMLButtonElement>('.ws-gmenu-sticker'), picture = sticker?.querySelector('img');
    expect(sticker?.classList.contains('found')).toBe(true); expect(sticker?.textContent).toContain('Moon trophy');
    if (tint === undefined) {
      expect(picture?.getAttribute('src')).toBe(image); expect(picture?.alt).toBe(''); expect(picture?.hasAttribute('onerror')).toBe(false);
    } else {
      const holder = sticker?.querySelector<HTMLElement>('.ws-gmenu-stickicon');
      expect(picture).toBeNull(); expect(holder?.classList.contains('tinted')).toBe(true);
      expect(holder?.style.maskImage).toBe(`url(${JSON.stringify(image)})`);
    }
    sticker?.click(); expect(picked).toHaveBeenCalledWith('moon.trophy');
  } finally { scope.dispose(); }
});
