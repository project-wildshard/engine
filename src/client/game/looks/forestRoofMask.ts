/** Client-only rain/roof query over admitted native deck and cave facts. */
import * as v from 'valibot';
import { ForestRoofMaskSchema } from '@wildshard/format/rangedPage';
import { insidePolygon, type YawFrame } from '@wildshard/engine/world/yawFrame';

interface FootprintFrame {
  readonly x: number;
  readonly z: number;
  readonly cosine: number;
  readonly sine: number;
  readonly reach: number;
}

function footprint({ x, z, yaw }: YawFrame, reach: number): FootprintFrame {
  // The local L1 radius bounds either world axis after rotation. A
  // little rounding room keeps exact edge samples on the narrow test.
  return { x, z, cosine: Math.cos(yaw), sine: Math.sin(yaw), reach: reach + Math.max(reach, 1) * (4 * Number.EPSILON) };
}

export class ForestRoofMask {
  private readonly floors;
  private readonly roofs;
  constructor(input: unknown) {
    const { floors, roofs } = v.parse(ForestRoofMaskSchema, input);
    this.floors = floors.map(({ x, z, rot, hw, hd }) => Object.assign(footprint({ x, z, yaw: rot }, Math.abs(hw) + Math.abs(hd)), { hw, hd }));
    this.roofs = roofs.map(({ frame, polygon }) => {
      const reach = polygon.reduce((extent, [x, z]) => Math.max(extent, Math.abs(x) + Math.abs(z)), 0);
      return Object.assign(footprint(frame, reach), { polygon });
    });
  }

  contains(x: number, z: number): boolean {
    for (const floor of this.floors) {
      const dx = x - floor.x, dz = z - floor.z;
      if (Math.abs(dx) > floor.reach || Math.abs(dz) > floor.reach) continue;
      const lx = dx * floor.cosine - dz * floor.sine, lz = dx * floor.sine + dz * floor.cosine;
      if (Math.abs(lx) <= floor.hw && Math.abs(lz) <= floor.hd) return true;
    }
    for (const roof of this.roofs) {
      const dx = x - roof.x, dz = z - roof.z;
      if (Math.abs(dx) > roof.reach || Math.abs(dz) > roof.reach) continue;
      const lx = dx * roof.cosine - dz * roof.sine, lz = dx * roof.sine + dz * roof.cosine;
      if (insidePolygon(roof.polygon, lx, lz)) return true;
    }
    return false;
  }
}
