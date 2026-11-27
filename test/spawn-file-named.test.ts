// SF7 (meta standalone shardfiles): a cook of Nine Dragon failed three tries with a bare "Invalid spawn file", naming no
// file, so nothing said which row the cook made wrong. The refusal now names the row.
import {describe, expect, it} from 'vitest';
import {readSpawnManifest} from '../src/shared/game/shardfile/spawnManifest';
import {stderrSummary} from '../src/cook/game/cookWorker';

const hash = 'a'.repeat(64);
describe('readSpawnManifest', () => {
  it('says when a manifest names one file twice', () => {
    const files = [{url: '/assets/z/a.ktx2', bytes: 4, hash}, {url: '/assets/z/a.ktx2', bytes: 4, hash}];
    expect(() => readSpawnManifest({version: 1, shard: 'z', tier: 'phone', flow: 'client', files, totalBytes: 8})).toThrow(/Invalid spawn file \(named twice\): .*a\.ktx2/u);
  });

  it('names the spawn file it refuses', () => {
    const files = [{url: '/assets/z/bad#data', bytes: 4, hash}];
    expect(() => readSpawnManifest({version: 1, shard: 'z', tier: 'phone', flow: 'client', files, totalBytes: 4})).toThrow(/Invalid spawn file: .*bad#data/u);
  });
});

describe('stderrSummary', () => {
  it('leads with the error line, past report-only lines and a code frame', () => {
    const stderr = ['Headless memory report-only (G433): z: 1 playing bytes', 'Headless memory report-only (G433): z: 2 playing bytes', 'file:///x/spawnManifest.ts:49', '    || seen.has(url)) throw new Error(\'Invalid spawn file\');', '       ^', '', 'Error: Invalid spawn file: {"url":"/assets/z/bad#data"}', '    at spawnFile (file:///x/spawnManifest.ts:49:9)'].join('\n');
    expect(stderrSummary(stderr)).toMatch(/^Error: Invalid spawn file: .*bad#data/u);
  });
});
