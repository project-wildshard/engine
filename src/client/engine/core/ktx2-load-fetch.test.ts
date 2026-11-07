import { expect, test, vi } from 'vitest';
import { CompressedTexture, LoadingManager } from 'three';
import { loadKtx2 } from './ktx2';


// T10: KTX2 files are read with fetch, not three's FileLoader (whose progress re-stream cost ~200 ms of a Pine cold entry):
// the same URL resolution, one shared read per file in flight (so one transcode and one texture) and the same status rule.
function fixture() {
  const manager = new LoadingManager(), parsed: ArrayBuffer[] = [], textures = new Map<ArrayBuffer, CompressedTexture>();
  manager.setURLModifier(url => `${url}?v=7`);
  const target = { manager, path: '/assets/', requestHeader: { 'x-lane': 'sp-o3' }, withCredentials: false,
    parse(buffer: ArrayBuffer, onLoad?: (texture: CompressedTexture) => void): void {
      parsed.push(buffer);
      let texture = textures.get(buffer);
      if (texture === undefined) { texture = new CompressedTexture([], 4, 4); textures.set(buffer, texture); }
      onLoad?.(texture);
    } };
  return { target, parsed };
}

test('a KTX2 file is read once per resolved URL while in flight, through the page modifier, and parsed by its loader', async () => {
  const f = fixture(), requests: { url: string; init: RequestInit | undefined }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init });
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  });
  const [a, b] = await Promise.all([loadKtx2(f.target, 'rock.ktx2'), loadKtx2(f.target, 'rock.ktx2')]);
  expect(requests).toEqual([{ url: '/assets/rock.ktx2?v=7', init: { headers: { 'x-lane': 'sp-o3' }, credentials: 'same-origin' } }]);
  expect(a).toBe(b); expect(f.parsed).toHaveLength(2); expect(f.parsed[0]).toBe(f.parsed[1]);
  expect([...new Uint8Array(f.parsed[0] ?? new ArrayBuffer(0))]).toEqual([1, 2, 3]);
  await loadKtx2(f.target, 'rock.ktx2');
  expect(requests).toHaveLength(2); // a finished read is not kept
});

test('a KTX2 read refuses a failed status and is read again after', async () => {
  const f = fixture();
  let status = 404;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(new Uint8Array([9]), { status, statusText: 'Not Found' })));
  await expect(loadKtx2(f.target, 'gone.ktx2')).rejects.toThrow('responded with 404: Not Found');
  status = 200;
  await expect(loadKtx2(f.target, 'gone.ktx2')).resolves.toBeInstanceOf(CompressedTexture);
});
