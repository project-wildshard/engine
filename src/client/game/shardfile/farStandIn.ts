/**
 * G748 (Jake: real coarse far stand-ins for occupied tiles, no boxes, each shard in its own style): the entered cell's far
 * stand-in. Beyond the render ring a tiled world draws only its landmarks' coarse copies (T11); the rest of its occupied
 * tiles went blank. The stand-in is the shard's own near view (`public/assets/baked/<slug>/near.glb`, its drawn world at a
 * low LOD in its own far look: the cell exactly as its neighbours see it), its ground left out (the entered world draws
 * its real ground) and the tiles the render ring draws in full masked out per fragment (an 8 x 8 positional mask).
 *
 *   const standIn = farStandIn(ctx);                       // null: the shard bakes no near view
 *   if (standIn !== null) scenes.addTiled(standIn);        // the tile driver builds it with the coarse stand-ins (T11)
 *
 * A triangle is ground when none of its corners rises more than `GROUND_SLACK` above the cell's terrain (the flat floor at
 * 0 for a world with none): the near bake lays its ground lattice over the same height field, and hangs skirts below it at
 * its region borders and leans its cell edge down (both under the ground, never above it).
 */
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import { versionedUrl } from '@wildshard/engine/boot/bytes';
import { publicBytes } from '@wildshard/engine/boot/tables';
import { readContent } from '@wildshard/engine/boot/contentRead';
import { farProxyMaterial } from '../grid/farView';
import { bakedNearFiles } from '../grid/nearPlaceholderView';
import type { ShardContext } from '../plugin/context';
import type { TileContent } from './tileContent';

/** metres a near-view corner may rise above the terrain and still count as ground */
export const GROUND_SLACK = 1.2;
const TILES = 64;
const num = v.number();
const NearLook = v.object({ look: v.object({ family: v.picklist(['toon', 'painterly', 'pbr']), haze: v.object({ colour: v.tuple([num, num, num]) }),
  grade: v.optional(v.object({ exposure: num, saturation: num, contrast: num, tint: v.optional(v.tuple([num, num, num])) })) }) });

/** The triangles of `geometry` that are not ground (some corner more than `GROUND_SLACK` above the terrain). */
export function withoutGround(geometry: BufferGeometry, heightAt: (x: number, z: number) => number): BufferGeometry {
  const position = geometry.getAttribute('position'), index = geometry.index;
  if (position === undefined || index === null) throw new Error('Near view needs an indexed position');
  const kept: number[] = [];
  for (let t = 0; t + 2 < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const ground = corners.every(c => position.getY(c) - heightAt(position.getX(c), position.getZ(c)) <= GROUND_SLACK);
    if (!ground) kept.push(...corners);
  }
  // the same vertex attributes (not copies): only the index is new
  const out = new BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) out.setAttribute(name, attribute);
  out.setIndex(new BufferAttribute(position.count > 65535 ? Uint32Array.from(kept) : Uint16Array.from(kept), 1));
  return out;
}

/** The entered shard's far stand-in as tile content (its `coarse` builds it), or null when it bakes no near view. */
export function farStandIn(ctx: ShardContext): TileContent | null {
  const slug = ctx.product.slug, files = bakedNearFiles(slug, publicBytes());
  if (files === null) return null;
  return { id: `${slug}.far-stand-in`, tiles: () => new Set<number>(), attach: () => Promise.resolve(),
    coarse: async (scope: Scope, rendered: (tile: number) => boolean) => {
      const bytes = await readContent(versionedUrl(files.row), 25_000_000, {fetch: (address, init) => fetch(address, init)});
      const { look } = v.parse(NearLook, JSON.parse(new TextDecoder().decode(bytes)));
      const gltf = await (await prepareRigLoader()).createRigLoader().loadAsync(versionedUrl(files.mesh));
      if (scope.disposed) return;
      let source: BufferGeometry | undefined;
      gltf.scene.traverse((node) => { if (source === undefined && node instanceof Mesh) { const found: unknown = node.geometry; if (found instanceof BufferGeometry) source = found; } });
      if (source === undefined) throw new Error(`near.glb ${slug}: no mesh`);
      const terrain = ctx.manifest.ground.terrain, geometry = withoutGround(source, (x, z) => terrain?.heightAt(x, z) ?? 0);
      const { material, setMask } = farProxyMaterial(look, true, false, 8), mesh = new Mesh(geometry, material);
      mesh.name = `${slug}.far-stand-in`; mesh.castShadow = false; mesh.receiveShadow = false;
      ctx.root.add(mesh);
      scope.onDispose(() => { mesh.removeFromParent(); geometry.dispose(); material.dispose(); });
      // the ring moves with the player: the tiles it draws in full leave the stand-in each frame
      let last = '';
      const drawn = new Set<number>();
      ctx.system({ id: `scene.${slug}.far-stand-in`, phase: 'update', run: () => {
        if (scope.disposed) return;
        drawn.clear(); let key = '';
        for (let tile = 0; tile < TILES; tile++) if (rendered(tile)) { drawn.add(tile); key += `${String(tile)},`; }
        if (key !== last) { last = key; setMask(drawn); }
      } });
    } };
}
