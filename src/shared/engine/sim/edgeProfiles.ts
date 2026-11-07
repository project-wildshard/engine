import type { StripProfile } from './strips';

/** Native bake rows have 256 samples; tile bakes have 257. Neither is decimated for platform seams. */
export type EdgeResolution = 256 | 257;
/** Boundary rows run west→east on north/south and south→north on east/west. North is positive z. */
export type EdgeProfiles = Readonly<Record<'north' | 'east' | 'south' | 'west', StripProfile>>;
/** Linear RGB, supplied by the admitted terrain palette rather than a renderer dependency. */
export type EdgeColour = readonly [number, number, number];
const sides = ['north', 'east', 'south', 'west'] as const;
// Only private copies made below carry this proof; frozen caller objects do not.
const admittedProfiles = new WeakSet<StripProfile>();
function resolution(count: number): EdgeResolution {
  if (count !== 256 && count !== 257) throw new RangeError('Edge profiles require a native 256 or 257 sample row');
  return count;
}
function colour(rgb: readonly number[]): EdgeColour {
  const [r, g, b] = rgb;
  if (rgb.length !== 3 || r === undefined || g === undefined || b === undefined || rgb.some((c) => !Number.isFinite(c) || c < 0 || c > 1)) throw new RangeError('Invalid edge colour');
  return [r, g, b];
}
/** Validate complete native rows before allocating a platform mesh. */
export function validateEdgeProfile(profile: StripProfile): void {
  if (admittedProfiles.has(profile)) return;
  validateProfile(profile, false);
}
/** Canonical numeric row JSON, retaining signed zero. Only detached private
 * snapshots may omit the replacer after checking their immutable numbers. */
export function edgeProfileJson(profile: StripProfile): string {
  const zero = (_key: string, value: unknown): unknown => typeof value === 'number' && Object.is(value, -0) ? '-0' : value;
  let plain = admittedProfiles.has(profile) && !('toJSON' in Array.prototype) && !Object.is(profile.roadHeight, -0);
  if (plain) {
    for (let i = 0; i < profile.heights.length; i++) if (Object.is(profile.heights[i], -0)) { plain = false; break; }
    let previous: readonly number[] | undefined;
    for (let i = 0; plain && i < profile.colours.length; i++) {
      const rgb = profile.colours[i];
      if (rgb === previous || rgb === undefined) continue;
      for (let c = 0; c < rgb.length; c++) if (Object.is(rgb[c], -0)) { plain = false; break; }
      previous = rgb;
    }
  }
  const row = [profile.roadHeight, profile.heights, profile.colours];
  return plain ? JSON.stringify(row) : JSON.stringify(row, zero);
}
function validateProfile(profile: StripProfile, privateLeaves: boolean): void {
  resolution(profile.heights.length);
  if (profile.colours.length !== profile.heights.length || profile.roadHeight !== 0 || profile.heights.some((h) => !Number.isFinite(h) || Math.abs(h) > 250)) throw new RangeError('Invalid edge profile');
  let previous: readonly number[] | undefined;
  profile.colours.forEach((rgb) => {
    // Only the constructor's detached, equal private copies share leaves.
    // Public mutable or caller-frozen rows still validate every occurrence.
    if (!privateLeaves || rgb !== previous) { colour(rgb); previous = rgb; }
  });
}
/** Copy and admit a complete row, then freeze its numeric leaves. Later seam checks
 * reuse this exact snapshot's proof; mutable and caller-frozen rows are always checked. */
export function immutableEdgeProfile(profile: StripProfile): StripProfile {
  let previous: number[] | undefined;
  const snapshot = { roadHeight: profile.roadHeight, heights: Array.from(profile.heights),
    colours: Array.from(profile.colours, rgb => {
      // Copy every caller row before comparison/validation, including custom
      // iterators. Only equal private leaves share one frozen snapshot.
      const copy = Array.from(rgb);
      if (previous !== undefined && copy.length === previous.length && copy.every((value, index) => Object.is(value, previous?.[index]))) return previous;
      previous = copy; return copy;
    }) };
  validateProfile(snapshot, true);
  let frozen: readonly number[] | undefined;
  for (const rgb of snapshot.colours) if (rgb !== frozen) { Object.freeze(rgb); frozen = rgb; }
  Object.freeze(snapshot.heights); Object.freeze(snapshot.colours); Object.freeze(snapshot);
  admittedProfiles.add(snapshot);
  return snapshot;
}
/** Only boundary samples are observed; the caller admits the complete lattice layout. */
function copyEdges(count: EdgeResolution, heightAt: (index: number) => number | undefined, colourAt: (index: number) => EdgeColour): EdgeProfiles {
  const edge = (side: typeof sides[number]): StripProfile => {
    const heights: number[] = [], colours: EdgeColour[] = [];
    for (let i = 0; i < count; i++) {
      const x = side === 'east' ? count - 1 : side === 'west' ? 0 : i;
      const z = side === 'north' ? count - 1 : side === 'south' ? 0 : i;
      const at = z * count + x, h = heightAt(at);
      if (h === undefined || !Number.isFinite(h) || Math.abs(h) > 250) throw new RangeError(`Invalid ${side} edge height`);
      heights.push(h); colours.push(colour(colourAt(at)));
    }
    return { heights, colours, roadHeight: 0 };
  };
  return { north: edge('north'), east: edge('east'), south: edge('south'), west: edge('west') };
}
/** Decode only the pure WSTR bake data. Four palette colours correspond to its four splat channels. */
export function bakedEdgeProfiles(bytes: Uint8Array, palette: readonly [EdgeColour, EdgeColour, EdgeColour, EdgeColour]): EdgeProfiles {
  if (bytes.length < 24) throw new RangeError('Truncated terrain bake');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x52545357 || view.getUint32(4, true) !== 1 || view.getFloat32(12, true) !== 500) throw new RangeError('Invalid terrain bake header');
  const count = resolution(view.getUint32(8, true)), n = count ** 2, end = 24 + n * 8;
  if (bytes.length < end) throw new RangeError('Truncated terrain bake lattice');
  if (bytes.length > end) {
    if (bytes.length < end + 24 || view.getUint32(end, true) !== 0x4c505357 || view.getUint32(end + 4, true) !== 1) throw new RangeError('Invalid terrain bake trailer');
    const decisions = view.getUint32(end + 8, true), kinds = view.getUint32(end + 12, true);
    if (bytes.length !== end + 24 + kinds * 4 + Math.ceil(decisions / 8)) throw new RangeError('Invalid terrain bake trailer size');
  }
  palette.forEach((rgb) => { colour(rgb); });
  // DataView supports subarrays with unaligned byte offsets, without host-endian assumptions.
  return copyEdges(count, index => view.getFloat32(24 + index * 4, true), (index) => {
    const weights = Array.from({ length: 4 }, (_, i) => view.getUint8(24 + n * 4 + index * 4 + i));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum === 0) throw new RangeError('Empty terrain boundary splat');
    const channel = (c: number): number => palette.reduce((total, rgb, i) => total + (rgb[c] ?? 0) * (weights[i] ?? 0) / sum, 0);
    return [channel(0), channel(1), channel(2)];
  });
}
/** Sorted union preserves both neighbours' exact native vertices when 256 and 257 rows meet. */
export function edgeSampleLocations(profiles: readonly StripProfile[]): readonly number[] {
  profiles.forEach(validateEdgeProfile);
  return [...new Set(profiles.flatMap((p) => p.heights.map((_, i) => -250 + i * 500 / (p.heights.length - 1))))].sort((a, b) => a - b);
}
/** Linear interpolation matches the boundary's actual mesh segments at the other neighbour's vertices. */
export function edgeSample(profile: StripProfile, at: number): { height: number; colour: EdgeColour } {
  if (!Number.isFinite(at) || at < -250 || at > 250) throw new RangeError('Edge sample outside cell');
  const u = (at + 250) * (profile.heights.length - 1) / 500, i = Math.min(profile.heights.length - 2, Math.floor(u)), t = u - i;
  const a = profile.heights[i], b = profile.heights[i + 1], ca = profile.colours[i], cb = profile.colours[i + 1];
  if (a === undefined || b === undefined || ca === undefined || cb === undefined) throw new RangeError('Missing native edge sample');
  const channel = (c: number): number => (ca[c] ?? 0) + ((cb[c] ?? 0) - (ca[c] ?? 0)) * t;
  return { height: a + (b - a) * t, colour: [channel(0), channel(1), channel(2)] };
}
