import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { objectHeaders } from '../src/cook/game/cookWorker.ts';
import { r2Store } from '../src/cook/game/packStore.ts';

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to run the pack index CDN contract`);
  return value;
}

// QA45: opt in with WS_PACK_INDEX_CACHE_CONTRACT=1 and the packs writer
// settings. The live probe owns one fresh key and removes it after readback.
test.skipIf(process.env['WS_PACK_INDEX_CACHE_CONTRACT'] !== '1')('an index published after a miss is immediately readable at the same URL', async () => {
  const bucket = setting('R2_BUCKET_PACKS');
  expect(bucket).toBe('wildshard-packs');
  const store = r2Store({
    bucket,
    endpoint: `https://${setting('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    accessKeyId: setting('R2_PACKS_ACCESS_KEY_ID'),
    secretAccessKey: setting('R2_PACKS_SECRET_ACCESS_KEY'),
  });
  const build = randomBytes(20).toString('hex');
  const hash = randomBytes(32).toString('hex');
  const key = `index/${build}/${hash}.json`;
  const url = `https://packs.wildshard.io/${key}`;
  const origin = 'https://staging.wildshard.io';
  const read = () => fetch(url, { headers: { Origin: origin }, signal: AbortSignal.timeout(15_000) });
  const index = { build, hash };
  const body = new TextEncoder().encode(JSON.stringify(index));

  expect(await store.has(key)).toBe(false);
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = await read();
    await missing.body?.cancel();
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cf-cache-status')).not.toBe('HIT');
  }
  try {
    await store.putImmutable(key, body, objectHeaders(key));
    const published = await read();
    expect(published.status).toBe(200);
    expect(published.headers.get('access-control-allow-origin')).toBe(origin);
    expect(await published.json()).toEqual(index);

    const cached = await read();
    await cached.body?.cancel();
    expect(cached.status).toBe(200);
    expect(cached.headers.get('cf-cache-status')).toBe('HIT');
  } finally {
    await store.remove(key);
  }
  expect(await store.has(key)).toBe(false);
}, 60_000);
