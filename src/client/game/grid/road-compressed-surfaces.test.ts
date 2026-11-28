import {expect, test, vi} from 'vitest';
import {CompressedTexture, RGBA_ASTC_6x6_Format, SRGBColorSpace} from 'three';
import {Scope} from '@wildshard/engine/app/scope';
import {ResidencyAllocator} from '../../../shared/game/grid/allocator';
import {PlatformRenderResidency} from './renderResidency';
import {RoadMapShare} from './roadResources';
import {compressedRoadSupport, prepareRoadSurfaceMaps, roadSurfaceBytes} from './roadCompressedSurfaces';

function native(url: string): CompressedTexture {
  const width = 1024, height = url.includes('asphalt') ? 512 : 1024;
  const mipmaps = Array.from({length: 11}, (_, level) => {
    const w = Math.max(1, width >> level), h = Math.max(1, height >> level);
    return {width: w, height: h, data: new Uint8Array(Math.ceil(w / 6) * Math.ceil(h / 6) * 16)};
  });
  const texture = new CompressedTexture(mipmaps, width, height, RGBA_ASTC_6x6_Format);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
function rig() {
  const scope = new Scope('compressed road'), allocator = new ResidencyAllocator();
  return {scope, allocator, admission: new PlatformRenderResidency(allocator, scope), maps: new RoadMapShare()};
}
test('only a phone with proven native sRGB ASTC 6x6 sampling uses the maps', () => {
  expect(compressedRoadSupport('phone', true)).toBe(true);
  expect(compressedRoadSupport('desktop', true)).toBe(false);
  expect(compressedRoadSupport('phone', false)).toBe(false);
});
test('surface admission publishes the complete pair once and the last borrower owns disposal', async () => {
  const r = rig(), loaded: CompressedTexture[] = []; let disposed = 0, uploads = 0;
  try {
    expect(await prepareRoadSurfaceMaps(r.admission, r.maps, {supported: true,
      read: url => { const texture = native(url); loaded.push(texture); texture.addEventListener('dispose', () => { disposed++; }); return Promise.resolve(texture); },
      upload: (_texture, current) => { expect(current()).toBe(true); uploads++; return Promise.resolve(); }})).toBe(true);
    expect(uploads).toBe(2); expect(loaded).toHaveLength(2);
    expect(r.maps.has('road.junctions')).toBe(true); // the road builder's junction slot
    const asphalt = r.maps.take('road.asphalt'); if (asphalt === undefined) throw new Error('Missing shared asphalt');
    r.scope.dispose(); expect(disposed).toBe(1);
    r.maps.release('road.asphalt', asphalt); expect(disposed).toBe(2);
    expect(roadSurfaceBytes(1024, 512) + roadSurfaceBytes(1024, 1024)).toBe(941280);
  } finally { r.scope.dispose(); }
});
test('unsupported, partially failed and retired preparations leave the procedural fallback intact', async () => {
  const skipped = rig();
  try {
    expect(await prepareRoadSurfaceMaps(skipped.admission, skipped.maps, {supported: false, read: () => { throw new Error('must not load'); }})).toBe(false);
    let disposed = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await prepareRoadSurfaceMaps(skipped.admission, skipped.maps, {supported: true,
      read: url => { if (url.includes('junction')) return Promise.reject(new Error('offline')); const t = native(url); t.addEventListener('dispose', () => { disposed++; }); return Promise.resolve(t); },
      upload: () => Promise.resolve()})).toBe(false);
    expect(disposed).toBe(1); expect(skipped.maps.has('road.asphalt')).toBe(false); expect(skipped.maps.has('road.junctions')).toBe(false);
    expect(warn).toHaveBeenCalledWith('[grid] road surface maps refused; the procedural maps draw the road:', new Error('offline'));
    warn.mockRestore();
  } finally { skipped.scope.dispose(); }
  const retired = rig();
  try {
    expect(await prepareRoadSurfaceMaps(retired.admission, retired.maps, {supported: true,
      read: url => { retired.scope.dispose(); return Promise.resolve(native(url)); }, upload: () => Promise.resolve()})).toBe(false);
    expect(retired.maps.has('road.asphalt')).toBe(false);
  } finally { retired.scope.dispose(); }
});

test('stalled optional maps time out, abort their reads and dispose a late texture', async () => {
  vi.useFakeTimers();
  const r = rig(); let finish: ((texture: CompressedTexture) => void) | undefined, disposed = 0;
  const signals: AbortSignal[] = [];
  try {
    const result = prepareRoadSurfaceMaps(r.admission, r.maps, {supported: true,
      read: (_url, signal) => { signals.push(signal); return new Promise(resolve => { finish = resolve; }); }});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBe(false); expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(r.allocator.has('platform:render:road.surface-maps')).toBe(false);
    const late = native('junction'); late.addEventListener('dispose', () => { disposed++; });
    finish?.(late); await Promise.resolve();
    expect(disposed).toBe(1); expect(r.maps.has('road.junctions')).toBe(false);
  } finally { r.scope.dispose(); vi.useRealTimers(); }
});
test('session disposal immediately cancels a stalled optional preparation', async () => {
  const r = rig(), signals: AbortSignal[] = [];
  const result = prepareRoadSurfaceMaps(r.admission, r.maps, {supported: true,
    read: (_url, signal) => { signals.push(signal); return new Promise(() => { /* Deliberately stalled reader. */ }); }});
  r.scope.dispose(); expect(await result).toBe(false);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

test('a refused upload is said, naming its texture, and the procedural maps keep the road (QA 11-25 row 151)', async () => {
  const r = rig(), warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const refusal = new Error('Graphics error 1280 after compressed texture 37812 (#10, 1024x512, 11 mips), the last of 1 boot upload checked together');
  try {
    expect(await prepareRoadSurfaceMaps(r.admission, r.maps, {supported: true, read: url => Promise.resolve(native(url)),
      upload: texture => texture.image.height === 512 ? Promise.reject(refusal) : Promise.resolve()})).toBe(false);
    expect(warn).toHaveBeenCalledWith('[grid] road surface maps refused; the procedural maps draw the road:', refusal);
    expect(r.maps.has('road.asphalt')).toBe(false); expect(r.maps.has('road.junctions')).toBe(false);
  } finally { warn.mockRestore(); r.scope.dispose(); }
});
