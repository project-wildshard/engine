// G496 restores the corrupt-save coin regression removed in 819a36b8d.
import { describe, expect, it } from 'vitest';
import { SaveStore } from '../src/shared/engine/saves/store';
import { Purse } from '../src/shared/game/loot/Purse';
import { purseKey } from '../src/shared/game/localSaveKeys';
import { MemoryStorage } from './setup';

const DRIFT = 'chunk://local/driftwood-isle';

describe('Purse corrupt-save recovery', () => {
  it.each(['lots', -4, null, { coins: 50 }])('ignores invalid saved coins %j', value => {
    const local = new MemoryStorage();
    local.setItem('wildshard.save.v2.driftwood-isle', JSON.stringify({keys: {purse: {v: 1, data: value}}}));
    const store = new SaveStore({local, session: null});
    const purse = new Purse(DRIFT, store.define(purseKey));
    expect(purse.coins).toBe(0);
    purse.add(3);
    expect(purse.coins).toBe(3);
    expect(new Purse(DRIFT, store.define(purseKey)).coins).toBe(3);
    expect(new Purse('pine-hollow', store.define(purseKey)).coins).toBe(0);
  });

  it('survives malformed JSON and a throwing store, retaining coins for retry', () => {
    const local = new MemoryStorage();
    local.setItem('wildshard.save.v2.driftwood-isle', '{broken');
    const storage = {get length() { return local.length; }, key: (index: number) => local.key(index),
      getItem: (key: string) => local.getItem(key), removeItem: (key: string) => { local.removeItem(key); },
      setItem: () => { throw new Error('private mode'); }};
    const purse = new Purse(DRIFT, new SaveStore({local: storage, session: null}).define(purseKey));
    expect(purse.coins).toBe(0);
    purse.add(3);
    expect(purse.coins).toBe(3);
    expect(purse.unsaved).toBe(true);
    expect(purse.flush()).toBe(false);
    expect(purse.coins).toBe(3);
  });
});
