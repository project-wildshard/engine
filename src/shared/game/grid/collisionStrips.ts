import type { GeneratedStrip, StripMesh } from '@wildshard/engine/sim/strips';

/** Native reinstallation data; presentation colours are consumed once by the road builder. */
export type CollisionMesh = Pick<StripMesh, 'origin' | 'positions' | 'indices'>;
/** Platform placement and entry metadata without references to render-only colour arrays or seam features. Features
 * (~55k small objects at the Driftwood dock) are read only by the presentation builders before this copy is made, and
 * every retained object lengthens WebKit's full collection (DF11 relay 7). */
export type CollisionStrip = Omit<GeneratedStrip, 'mesh' | 'duplicates' | 'features'> & {
  readonly mesh: CollisionMesh;
  readonly duplicates: readonly { readonly instance: string; readonly mesh: CollisionMesh }[];
};

/** Retain the exact shared native buffers and placements after presentation construction, never their colours or features. */
export function collisionStrips(strips: readonly GeneratedStrip[]): readonly CollisionStrip[] {
  const mesh = ({ origin, positions, indices }: StripMesh): CollisionMesh => ({ origin, positions, indices });
  return strips.map(({ id, turnIn, mesh: source, duplicates }) => ({ id,
    ...(turnIn === undefined ? {} : { turnIn }), mesh: mesh(source),
    duplicates: duplicates.map(({ instance, mesh: duplicate }) => ({ instance, mesh: mesh(duplicate) })),
  }));
}
