/** Client-only rain/roof query over admitted native deck and cave facts. */
import * as v from 'valibot';
import { ForestRoofMaskSchema } from '@wildshard/format/rangedPage';
import { floorAtRects } from '@wildshard/engine/physics/box';
import { yawLocal, insidePolygon } from '@wildshard/engine/world/yawFrame';

export class ForestRoofMask {
  private readonly rows;
  constructor(input: unknown) { this.rows = v.parse(ForestRoofMaskSchema, input); }
  contains(x: number, z: number): boolean {
    return floorAtRects(this.rows.floors, x, z, 'first') !== undefined || this.rows.roofs.some(row => {
      const [lx, lz] = yawLocal(row.frame, x, z); return insidePolygon(row.polygon, lx, lz);
    });
  }
}
