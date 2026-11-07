import type { GeneratedStrip, StripMesh } from '@wildshard/engine/sim/strips';

/** Native reinstallation data; presentation colours are consumed once by the road builder. */
export type CollisionMesh = Pick<StripMesh, 'origin' | 'positions' | 'indices'>;
/** Platform placement and surface/entry metadata without references to render-only colour arrays. */
export type CollisionStrip = Omit<GeneratedStrip, 'mesh' | 'duplicates'> & {
  readonly mesh: CollisionMesh;
  readonly duplicates: readonly { readonly instance: string; readonly mesh: CollisionMesh }[];
};

/** Retain the exact shared native buffers and placements after presentation construction, never their colours. */
export function collisionStrips(strips: readonly GeneratedStrip[]): readonly CollisionStrip[] {
  const mesh = ({ origin, positions, indices }: StripMesh): CollisionMesh => ({ origin, positions, indices });
  return strips.map(({ id, features, turnIn, mesh: source, duplicates }) => ({ id, features,
    ...(turnIn === undefined ? {} : { turnIn }), mesh: mesh(source),
    duplicates: duplicates.map(({ instance, mesh: duplicate }) => ({ instance, mesh: mesh(duplicate) })),
  }));
}
