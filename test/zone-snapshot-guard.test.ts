// ZONE-SNAPSHOTS ZS1 (J507): the guard refuses each kind of zone snapshot a lane might check in.
import { describe, expect, it } from 'vitest';
import { judge, zoneSnapshotOffenders } from '../scripts/zone-snapshot-guard.mjs';

const CURRENT = '0.1.0.6';
const ZONES = ['pine-hollow', 'nalati-grasslands', 'sunscar-dunes'];

function scan(files: Record<string, string>): string[] {
  return zoneSnapshotOffenders({ paths: Object.keys(files), read: (path: string) => files[path] ?? '', current: CURRENT, zones: ZONES });
}

describe('zone-snapshot guard', () => {
  it('refuses a pin record outside test/pins', () => {
    const record = JSON.stringify({ slug: 'pine-hollow', revision: 7, hash: 'a'.repeat(64) });
    expect(scan({ 'test/fixtures/old-pins.json': record, 'test/pins/shardfiles.json': record })).toEqual(['pin-record test/fixtures/old-pins.json']);
    expect(scan({ 'test/pine.test.ts': `readPin('~/.cache/wildshard/pins/${'b'.repeat(64)}.tar')` })).toEqual(['pin-record test/pine.test.ts']);
  });

  it('refuses a 0.1 shard folder outside the fixtures and a folder naming a zone, not a made-up one at any format', () => {
    expect(scan({ 'test/old/shard.json': JSON.stringify({ formatVersion: 2, version: '0.1' }) })).toEqual(['shard-folder test/old/shard.json']);
    expect(scan({ 'test/fixtures/made-up-old/shard.json': JSON.stringify({ version: '0.1', identity: { slug: 'cli-fixture' } }) })).toEqual([]);
    expect(scan({ 'test/fixtures/old/shard.json': JSON.stringify({ version: '0.1', identity: { slug: 'pine-hollow' } }) })).toEqual(['shard-folder test/fixtures/old/shard.json']);
    expect(scan({ 'test/fixtures/z/shard.json': JSON.stringify({ formatVersion: CURRENT, identity: { slug: 'nalati-grasslands' } }) })).toEqual(['shard-folder test/fixtures/z/shard.json']);
    expect(scan({ 'test/fixtures/made-up/shard.json': JSON.stringify({ formatVersion: CURRENT, identity: { slug: 'closure-a' } }) })).toEqual([]);
  });

  it('refuses a fixture naming a zone revision', () => {
    expect(scan({ 'test/fixtures/pine-hollow-r7.json': '{}' })).toEqual(['revision-path test/fixtures/pine-hollow-r7.json']);
    expect(scan({ 'test/fixtures/dunes-r3-keeper.ts': '' })).toEqual(['revision-path test/fixtures/dunes-r3-keeper.ts']);
    expect(scan({ 'test/fixtures/brook-r2.json': '{}', 'project/journal/pine-hollow-r7.md': '' })).toEqual([]);
  });

  it('refuses frozen extracts and lift originals', () => {
    expect(scan({ 'test/fixtures/frozen/x.json': '{}', 'test/fixtures/nalati-audio-original.json': '{}' })).toEqual([
      'frozen-path test/fixtures/frozen/x.json',
      'frozen-path test/fixtures/nalati-audio-original.json',
    ]);
  });

  it('lets the baseline only shrink', () => {
    expect(judge(['a', 'b'], ['a', 'b', 'c'])).toEqual({ added: [], gone: ['c'] });
    expect(judge(['a', 'd'], ['a'])).toEqual({ added: ['d'], gone: [] });
  });
});
