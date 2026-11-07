/** A box specified in world space, rotated by −rot about +Y. */
export interface BoxSpec { x: number; z: number; hw: number; hd: number; rot: number; yTop: number; yBottom: number }

/** A horizontal deck rectangle, or a ramp rising `slope` metres per metre along its local +z and `tilt` along its local
 * +x (`y` at its centre); rot uses the same negative-Y convention as BoxSpec. */
export interface FloorRect { readonly x: number; readonly z: number; readonly hw: number; readonly hd: number; readonly y: number; readonly rot?: number; readonly slope?: number; readonly tilt?: number;
  /** Ordered local +z, half-width and relative height knots for a tapered deck or multi-slope ramp. */
  readonly profile?: readonly (readonly [number, number, number])[] }

/** A floor on a turned site's local z axis (own space): centred at local `lz`, a ramp rising `slope` along local +z. */
export const siteFloor = (rot: number, lz: number, hw: number, hd: number, y: number, slope?: number): FloorRect =>
  ({ x: lz * Math.sin(rot), z: lz * Math.cos(rot), hw, hd, y, rot, ...(slope === undefined ? {} : { slope }) });

/** Query inclusive deck bounds without building collision. First preserves authored priority; highest chooses the
 * uppermost matching floor. The scalar inverse turn retains the original floor arithmetic and input order. */
export function floorAtRects(floors: readonly FloorRect[], x: number, z: number, policy: 'first' | 'highest'): number | undefined {
  let best: number | undefined;
  for (const f of floors) {
    const c = Math.cos(f.rot ?? 0), s = Math.sin(f.rot ?? 0);
    const lx = (x - f.x) * c - (z - f.z) * s, lz = (x - f.x) * s + (z - f.z) * c;
    if (f.profile !== undefined) {
      for (let i = 1; i < f.profile.length; i++) {
        const a = f.profile[i - 1], b = f.profile[i];
        if (a === undefined || b === undefined || lz < a[0] || lz > b[0] || b[0] <= a[0]) continue;
        const t = (lz - a[0]) / (b[0] - a[0]);
        if (Math.abs(lx) <= a[1] + (b[1] - a[1]) * t) {
          const y = f.y + a[2] + (b[2] - a[2]) * t;
          if (policy === 'first') return y;
          if (best === undefined || y > best) best = y;
          break;
        }
      }
      continue;
    }
    if (Math.abs(lx) <= f.hw && Math.abs(lz) <= f.hd) {
      const along = f.slope === undefined ? f.y : f.y + f.slope * lz, y = f.tilt === undefined ? along : along + f.tilt * lx;
      if (policy === 'first') return y;
      if (best === undefined || y > best) best = y;
    }
  }
  return best;
}
