/** Collision-only chamber dimensions, independent of the arena's view. */
export interface ArenaSealDimensions {
  readonly doorHeight: number; readonly halfWidth: number; readonly doorHalfWidth: number;
}
/** The registered seal's original local box; its owner supplies pose and activity. */
export function arenaSealCollider(rows: ArenaSealDimensions): {kind:'box';x:number;y:number;z:number;hx:number;hy:number;hz:number} {
  return {kind:'box',x:0,y:rows.doorHeight/2,z:rows.halfWidth+0.1,hx:rows.doorHalfWidth+0.3,hy:rows.doorHeight/2+1,hz:0.25};
}
/** Whether a native collider is the room's door. The bake's seal carries no tag, and a restored world loses tags, so it
 *  is known as `nativeArenaSealSolids` knew it: by its box and pose. */
export function isArenaSeal(collider: { translation: () => { x: number; y: number; z: number }; halfExtents: () => { x: number; y: number; z: number } | null },
  room: ArenaSealDimensions & { readonly origin: { readonly x: number; readonly y: number; readonly z: number } }): boolean {
  const box = arenaSealCollider(room), at = collider.translation(), half = collider.halfExtents(), near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
  return half !== null && near(at.x, room.origin.x + box.x) && near(at.y, room.origin.y + box.y) && near(at.z, room.origin.z + box.z)
    && near(half.x, box.hx) && near(half.y, box.hy) && near(half.z, box.hz);
}
