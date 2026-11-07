import { Box3, Group, Vector3, type Matrix4, type BufferGeometry } from 'three';
import { tileBoxVisible, type BakeCamera } from '../../scripts/tile-bake-report.mjs';
import type { WorldSceneWeld } from '@wildshard/format/worldSceneWeld';

export interface SlabVisibilityBox { box: Box3; triangles: number }

/** Test-side scene graph reconstruction; chunk bounds are transformed only for this offline frustum census. */
export function slabAnchorFrames(weld: WorldSceneWeld): ReadonlyMap<string, Matrix4> {
  const root = new Group(), nodes = new Map([[weld.root, root]]);
  for (const row of weld.nodes) {
    const object = new Group(); object.matrixAutoUpdate = row.matrixAutoUpdate;
    if (row.transformBits !== undefined) {
      const values = new Float64Array(Uint32Array.from(row.transformBits).buffer);
      object.position.fromArray(values); object.quaternion.fromArray(values, 3); object.scale.fromArray(values, 7);
    }
    if (row.matrixBits !== undefined) object.matrix.fromArray(new Float64Array(Uint32Array.from(row.matrixBits).buffer));
    nodes.set(row.id, object);
  }
  for (const row of weld.nodes) {
    const parent = nodes.get(row.parent), object = nodes.get(row.id);
    if (parent === undefined || object === undefined) throw new Error('Unknown slab census anchor');
    parent.add(object);
  }
  root.updateMatrixWorld(true);
  return new Map([...nodes].map(([id, object]) => [id, object.matrixWorld.clone()]));
}

/** Literal quadrant-only baseline with the same intact triangles. No height or byte split is charged here. */
export function addQuadrantVisibility(boxes: Map<string, SlabVisibilityBox>, geometry: BufferGeometry, frame: Matrix4, tile: number, key: string): void {
  const position = geometry.getAttribute('position'), index = geometry.index, count = index?.count ?? position.count;
  const points = [new Vector3(), new Vector3(), new Vector3()], centre = new Vector3();
  for (let offset = 0; offset < count; offset += 3) {
    centre.set(0, 0, 0);
    for (const [corner, point] of points.entries()) {
      point.fromBufferAttribute(position, index?.getX(offset + corner) ?? offset + corner).applyMatrix4(frame); centre.addScaledVector(point, 1 / 3);
    }
    const x = -250 + tile % 8 * 62.5, z = -250 + Math.floor(tile / 8) * 62.5;
    const quadrant = Number(centre.x >= x + 31.25) + 2 * Number(centre.z >= z + 31.25), id = `${tile}/${key}/${quadrant}`;
    const row = boxes.get(id) ?? { box: new Box3(), triangles: 0 };
    for (const point of points) row.box.expandByPoint(point);
    row.triangles++; boxes.set(id, row);
  }
}

/** Conservative box-only visibility: original anchor distance bands and shadow/post passes are deliberately not simulated. */
export function slabVisibilityCensus(chunks: readonly SlabVisibilityBox[], quadrants: readonly SlabVisibilityBox[], cameras: readonly BakeCamera[]): {
  name: string; chunks: number; triangles: number; quadrantTriangles: number; extraCulledFraction: number;
}[] {
  const visible = (rows: readonly SlabVisibilityBox[], camera: BakeCamera): SlabVisibilityBox[] => rows.filter(row => tileBoxVisible({ min: row.box.min.toArray(), max: row.box.max.toArray() }, camera));
  return cameras.map(camera => {
    const seen = visible(chunks, camera), baseline = visible(quadrants, camera), triangles = seen.reduce((sum, row) => sum + row.triangles, 0);
    const quadrantTriangles = baseline.reduce((sum, row) => sum + row.triangles, 0);
    return { name: camera.name, chunks: seen.length, triangles, quadrantTriangles, extraCulledFraction: quadrantTriangles === 0 ? 0 : (quadrantTriangles - triangles) / quadrantTriangles };
  });
}
