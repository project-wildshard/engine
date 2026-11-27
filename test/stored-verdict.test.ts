// oxlint-disable-next-line import/no-nodejs-modules -- The verdict names the header by its SHA-256.
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {storedVerdict} from '../src/scripts/app-build/catalogue';

// STANDALONE-SHARDFILES SF5d: a versioned shard's cook stamps its shardVersion into the header, so the page reads the
// cook's header, not the upload's. Pine Hollow 0.0.18 took stale-client recovery while the verdict named the upload's.
describe('a stored shard verdict', () => {
  it('names the header the page reads, keeping the rest of the upload verdict', () => {
    const header = new TextEncoder().encode('{"cook":{"shardVersion":"0.0.18"}}');
    const upload = {verdict: {revision: 'r', sourceHash: 's', indexHash: 'upload', path: '/shardfiles/z/shard.json'}, discovery: new Uint8Array([1])};
    const stored = storedVerdict(upload, header);
    expect(stored.verdict).toEqual({revision: 'r', sourceHash: 's', path: '/shardfiles/z/shard.json',
      indexHash: createHash('sha256').update(header).digest('hex')});
    expect(stored.discovery).toBe(upload.discovery);
  });
});
