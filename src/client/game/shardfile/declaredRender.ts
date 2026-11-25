/**
 * QA 11-24 row 59: a data zone's declared post look (its level manifest's `bindings.render`, carried in `ui/level`). Since a
 * shard became a plain data zone (ONE-FORMAT OF21, Nine Dragon on 11-19) no discovery document binds `render`, so the page
 * and the grid ran the data look alone and a declared post-graph look (Nine's `weapons/jian-row.json` `look.post`: its rain,
 * ink lines, wash and live frame channels) never ran. This reads the binding from the admitted source, as a discovery page
 * reads it from its document (`discovery.ts` `renderPost`).
 *
 * A painted look already runs from its `look/painted` section (`clientSource.ts`); a module binding or a `keyed` row names
 * compiled modules a data zone has none of. Those return null and the data look draws, as before.
 */
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { LookStrategy } from '@wildshard/engine/render/look';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/** A declared post-graph look: the product file and the field path to its row. */
export interface DeclaredPost { readonly file: string; readonly field: readonly string[] }

/** The data zone's declared post look, or null when it declares none. */
export function declaredPost(source: Pick<Shardfile, 'manifest'>): DeclaredPost | null {
  const row: unknown = source.manifest?.bindings.render;
  if (typeof row !== 'object' || row === null || !('platform' in row) || row.platform !== 'post' || !('file' in row) || !('field' in row)) return null;
  const { file, field } = row;
  if (typeof file !== 'string' || !Array.isArray(field) || !field.every((key): key is string => typeof key === 'string')) return null;
  return { file, field };
}

/** Make the declared post look from the zone's product (lazily, as a discovery page's `renderPost` binding does). */
export async function declaredPostLook(post: DeclaredPost, product: Pick<ShardFolder, 'slug' | 'shardfile' | 'json' | 'file'>): Promise<LookStrategy> {
  return (await import('../looks/postGraphLook')).postGraphLook(product, post);
}

/**
 * The declared post look laid over the zone's data look: the post look's colour chain (its composer passes, grid cell
 * composite, world preparation, frame channels, LUT and any sky dressing or painted world it declares) wins; the data look
 * keeps everything the post look does not name (its backdrop, lighting, shadows, fog and ground). Both dispose.
 */
export async function withDeclaredPost(data: Promise<LookStrategy>, post: Promise<LookStrategy>): Promise<LookStrategy> {
  const [base, over] = await Promise.all([data, post]);
  return { ...base, ...over, dispose: (): void => { over.dispose?.(); base.dispose?.(); } } as LookStrategy;
}
