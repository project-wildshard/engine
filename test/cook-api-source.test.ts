import {describe, expect, it} from 'vitest';
import {apiSource} from '../src/cook/game/cookWorker';

/** MS2.4 (meta MMO-SERVER-PLAN): a new author's `upload --channel staging` moves only the staging pointer, so the cook reads
 *  staging heads from `/api/catalogue`'s `channels.staging.raw` beside the old `live` and `preview` stages. */
const hash = (n: number): string => n.toString(16).padStart(64, '0');
const migration = (raw: string): unknown => ({raw, formatVersion: '0.1', migrations: [{raw, format: '0.1', hash: raw, chainId: 'identity', status: 'ok'}]});
const catalogue = {shards: [
  {slug: 'pinned', name: 'Pinned', live: {revision: 3, hash: hash(1)}, preview: {revision: 4, hash: hash(2)},
    channels: {preview: migration(hash(2)), staging: migration(hash(3)), production: migration(hash(1))}},
  {slug: 'new-author', name: 'New', channels: {staging: migration(hash(4))}},
  {slug: 'old-row', name: 'Old', live: {revision: 1, hash: hash(5)}},
]};
const source = apiSource('https://api.example', (async () => Response.json(catalogue)) as unknown as typeof fetch);

describe('the cook reads every channel it cooks for', () => {
  it('lists staging heads by their raw upload, including a slug with no production or preview head', async () => {
    expect(await source.heads('staging')).toEqual([{slug: 'pinned', hash: hash(3)}, {slug: 'new-author', hash: hash(4)}]);
  });
  it('keeps the old stages as they were', async () => {
    expect(await source.heads('live')).toEqual([{slug: 'pinned', revision: 3, hash: hash(1)}, {slug: 'old-row', revision: 1, hash: hash(5)}]);
    expect(await source.heads('preview')).toEqual([{slug: 'pinned', revision: 4, hash: hash(2)}]);
  });
  it('refuses a staging pointer that is not a hash', async () => {
    const bad = apiSource('https://api.example', (async () => Response.json({shards: [{slug: 'x', channels: {staging: {raw: '../etc'}}}]})) as unknown as typeof fetch);
    await expect(bad.heads('staging')).rejects.toThrow();
  });
});
