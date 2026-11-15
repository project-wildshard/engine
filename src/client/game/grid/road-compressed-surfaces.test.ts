import {expect, test} from 'vitest';
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
    expect(await prepareRoadSurfaceMaps(skipped.admission, skipped.maps, {supported: true,
      read: url => { if (url.includes('junction')) return Promise.reject(new Error('offline')); const t = native(url); t.addEventListener('dispose', () => { disposed++; }); return Promise.resolve(t); },
      upload: () => Promise.resolve()})).toBe(false);
    expect(disposed).toBe(1); expect(skipped.maps.has('road.asphalt')).toBe(false); expect(skipped.maps.has('road.junctions')).toBe(false);
  } finally { skipped.scope.dispose(); }
  const retired = rig();
  try {
    expect(await prepareRoadSurfaceMaps(retired.admission, retired.maps, {supported: true,
      read: url => { retired.scope.dispose(); return Promise.resolve(native(url)); }, upload: () => Promise.resolve()})).toBe(false);
    expect(retired.maps.has('road.asphalt')).toBe(false);
  } finally { retired.scope.dispose(); }
});
