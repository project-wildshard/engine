import {describe, expect, it} from 'vitest';
import {SHARDFILE_VERSION} from '@wildshard/format/version';
import {expectedCopyOf} from '../src/cook/game/cookProvenance';
import {apiSource} from '../src/cook/game/cookWorker';

/** MS2.4 (meta MMO-SERVER-PLAN): a new author's `upload --channel staging` moves only the staging pointer, so the cook reads
 *  staging heads from `/api/catalogue`'s `channels.staging.raw` beside the old `live` and `preview` stages. */
const hash = (n: number): string => n.toString(16).padStart(64, '0');
const migration = (raw: string): unknown => ({raw, formatVersion: '0.1', migrations: [{raw, format: '0.1', hash: raw, chainId: 'identity', status: 'ok'}]});
const catalogue = {shards: [
  {slug: 'pinned', name: 'Pinned', live: {uploadNumber: 3, shardVersion: '1.2.3', hash: hash(1)}, preview: {uploadNumber: 4, hash: hash(2)},
    channels: {preview: migration(hash(2)), staging: migration(hash(3)), production: migration(hash(1))}},
  {slug: 'new-author', name: 'New', channels: {staging: migration(hash(4))}},
  {slug: 'old-row', name: 'Old', live: {revision: 1, version: '0.2.0', hash: hash(5)}},
  // api-server sends every channel's block and leaves `raw` out where the channel has no pointer.
  {slug: 'live-only', name: 'Live only', live: {uploadNumber: 2, hash: hash(6)}, channels: {staging: {formatVersion: '0.1', migrations: []}, production: migration(hash(6))}},
]};
const source = apiSource('https://api.example', (async () => Response.json(catalogue)) as unknown as typeof fetch);

describe('the cook reads every channel it cooks for', () => {
  it('lists staging heads by their raw upload, including a slug with no production or preview head', async () => {
    expect(await source.heads('staging')).toEqual([{slug: 'pinned', hash: hash(3)}, {slug: 'new-author', hash: hash(4)}]);
  });
  it('keeps the old stages as they were', async () => {
    expect(await source.heads('live')).toEqual([{slug: 'pinned', uploadNumber: 3, shardVersion: '1.2.3', hash: hash(1)}, {slug: 'old-row', uploadNumber: 1, shardVersion: '0.2.0', hash: hash(5)}, {slug: 'live-only', uploadNumber: 2, hash: hash(6)}]);
    expect(await source.heads('preview')).toEqual([{slug: 'pinned', uploadNumber: 4, hash: hash(2)}]);
  });
  it('refuses a staging pointer that is not a hash', async () => {
    const bad = apiSource('https://api.example', (async () => Response.json({shards: [{slug: 'x', channels: {staging: {raw: '../etc'}}}]})) as unknown as typeof fetch);
    await expect(bad.heads('staging')).rejects.toThrow();
  });
});

/** SHARD-COMPAT CP2b2b: the API lists its migrated copy of each original; the cook takes the copy at its own format as the
 *  digest its chain must reproduce, and ignores refused rows, rows at another format and rows with no copy. */
describe('the API copy the cook must match', () => {
  const copy = (raw: string, extra: object): unknown => ({raw, format: SHARDFILE_VERSION, hash: hash(90), chainId: 'c'.repeat(64), status: 'ok', ...extra});
  const listing = {shards: [
    {slug: 'copied', live: {uploadNumber: 1, hash: hash(10)}, channels: {production: {raw: hash(10), migrations: [copy(hash(10), {format: '0.1.0.1'}), copy(hash(10), {})]}}},
    {slug: 'refused', channels: {staging: {raw: hash(11), migrations: [copy(hash(11), {status: 'refused', hash: undefined})]}}},
    {slug: 'other', channels: {staging: {raw: hash(12), migrations: [copy(hash(13), {})]}}},
  ]};
  const api = apiSource('https://api.example', (async () => Response.json(listing)) as unknown as typeof fetch);
  it('attaches the ok copy at the engine format to its head, from any channel block', async () => {
    expect(await api.heads('live')).toEqual([{slug: 'copied', uploadNumber: 1, hash: hash(10), expected: {chainId: 'c'.repeat(64), digest: hash(90)}}]);
  });
  it('attaches nothing for a refused copy or a copy of another original', async () => {
    expect(await api.heads('staging')).toEqual([{slug: 'refused', hash: hash(11)}, {slug: 'other', hash: hash(12)}]);
  });
  it('picks the row by original, format and status', () => {
    const rows = [{raw: hash(1), format: '0.1.0.1', hash: hash(2), chainId: 'a', status: 'ok'}, {raw: hash(1), format: '0.1.0.4', hash: hash(3), chainId: 'b', status: 'ok'}];
    expect(expectedCopyOf(hash(1), rows, '0.1.0.4')).toEqual({chainId: 'b', digest: hash(3)});
    expect(expectedCopyOf(hash(1), rows, '0.1.0.9')).toBeUndefined();
  });
});
