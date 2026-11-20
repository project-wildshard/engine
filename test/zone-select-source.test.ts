import { afterEach, expect, test, vi } from 'vitest';
import { installSaveEnvironment, saveEnvironment } from '../src/shared/engine/saves/environment';
import type { ZoneSelectDocument } from '../src/shared/game/grid/zoneSelectRows';
import { zoneSelectSource } from '../src/client/game/zoneSelect/served';

const original = saveEnvironment();
afterEach(() => { installSaveEnvironment(original); });

const stamp = { release: 'https://packs.example.test/releases/production.json', key: 'test' };
const door = { url: 'https://rooms.example.test/zone-select', channel: 'production' } as const;
const production: ZoneSelectDocument = { channel: 'production', serial: 9, featured: [], new: [], popular: [], all: [] };
const staging: ZoneSelectDocument = { ...production, channel: 'staging', serial: 10 };
const page = (doc?: ZoneSelectDocument): Pick<Document, 'getElementById'> => ({
  getElementById: id => doc === undefined || id !== 'ws-zone-select' ? null : { textContent: JSON.stringify(doc) } as HTMLElement,
});

test('each press goes to its signed door without waiting for a reply, and double taps are merged per zone', async () => {
  const read = vi.fn<typeof fetch>().mockRejectedValue(new Error('no connection'));
  let now = 10;
  const source = zoneSelectSource(page(), stamp, { fetch: read, locate: async () => door,
    pressPage: () => ({ origin: 'https://play.wildshard.io', actor: { actor: 'agent', lane: 'phone-proof' }, now }) });
  expect(source.press('pine-hollow')).toBeUndefined();
  source.press('pine-hollow');
  source.press('far-reach');
  await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(2); });
  now += 2000;
  source.press('pine-hollow');
  await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(3); });
  expect(read.mock.calls.map(([at, init]) => [at, init?.keepalive, init?.credentials, init?.headers, init?.body]))
    .toEqual(['pine-hollow', 'far-reach', 'pine-hollow'].map(slug => [
      'https://rooms.example.test/zone-select/enter?agent=phone-proof', true, 'omit', undefined,
      JSON.stringify({ slug, channel: 'production', audience: 'automation' }),
    ]));
});

test('a local or preview page never looks up the funnel door and a foreign channel receives no press', async () => {
  const locate = vi.fn(async () => door), fetchPress = vi.fn<typeof fetch>();
  let origin = 'http://localhost:4402';
  const source = zoneSelectSource(page(), stamp, { fetch: fetchPress, locate,
    pressPage: () => ({ origin, actor: { actor: 'human' }, now: 0 }) });
  source.press('pine-hollow');
  origin = 'https://preview.wildshard.io';
  source.press('pine-hollow');
  await Promise.resolve();
  expect(locate).not.toHaveBeenCalled();
  origin = 'https://staging.wildshard.io';
  source.press('pine-hollow');
  await vi.waitFor(() => { expect(locate).toHaveBeenCalledTimes(1); });
  expect(fetchPress).not.toHaveBeenCalled();
});

function device(): void {
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  installSaveEnvironment({ ...original, storage: () => storage });
}

test('starts with baked staging and refreshes from the signed world channel', async () => {
  device();
  const read = vi.fn<typeof fetch>(async () => Response.json(production));
  const source = zoneSelectSource(page(staging), stamp, { fetch: read, locate: async () => door });
  expect(source.initial()).toEqual(staging);
  expect(read).not.toHaveBeenCalled();
  await expect(source.refresh()).resolves.toEqual(production);
  expect(read).toHaveBeenCalledWith(door.url, expect.objectContaining({ credentials: 'omit' }));
  const offline = zoneSelectSource(page(staging), stamp, { fetch: read, locate: async () => null });
  expect(offline.initial()).toEqual(production);
  await expect(offline.refresh()).resolves.toBeNull();
});

test('malformed, wrong-channel and stale responses leave the kept document in place', async () => {
  device();
  const read = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(production))
    .mockResolvedValueOnce(new Response('junk'))
    .mockResolvedValueOnce(Response.json(staging))
    .mockResolvedValueOnce(Response.json({ ...production, serial: 8 }));
  const source = zoneSelectSource(page(), stamp, { fetch: read, locate: async () => door });
  expect(source.initial()).toBeNull();
  await expect(source.refresh()).resolves.toEqual(production);
  for (let i = 0; i < 3; i++) await expect(source.refresh()).resolves.toBeNull();
  expect(source.initial()).toEqual(production);
});

test('a late body leaves the snapshot and storage intact', async () => {
  device();
  let respond: ((reply: Response) => void) | undefined;
  const read = vi.fn<typeof fetch>(() => new Promise(resolve => { respond = resolve; }));
  const source = zoneSelectSource(page(staging), stamp, { fetch: read, locate: async () => door }, 20);
  await expect(source.refresh()).resolves.toBeNull();
  respond?.(Response.json(production));
  await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(source.initial()).toEqual(staging);
});

test('preview opens the snapshot without reading a world', async () => {
  const find = vi.fn(async () => door);
  const source = zoneSelectSource(page(staging), undefined, { fetch, locate: find });
  expect(source.initial()).toEqual(staging);
  await expect(source.refresh()).resolves.toBeNull();
  expect(find).not.toHaveBeenCalled();
});
