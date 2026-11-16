/**
 * A shard's detail layers on the page (meta SHARD-SOURCE AP32d1): each `look.details` row (format v0.7.0, AP32a) becomes one
 * `DetailLayer` (AP32b) under the shard's root, drawn with its look material and following the viewer each frame.
 *
 *   installClientDetails(source.look.details, assets, { root, scope, materials, viewer, frame, phone });
 *
 * The three files are library binaries (the charged library: the page has them before the world draws). A row whose files
 * do not match its counts, or whose material did not compile, is refused loudly: never a silently missing meadow.
 */
import { SRGBColorSpace, Color, type Material, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { detailFileFaults, type LookDetail } from '@wildshard/format/look-details';
import { DetailLayer } from '@wildshard/engine/world/detailLayer';
import type { DetailLayerSource } from '@wildshard/engine/world/detailRing';

type Rgb = readonly [number, number, number];

/** The format's tint is two sRGB multipliers; the ring writes them to `instanceColor`, which three reads as linear. */
export function linearTint(tint: readonly [Rgb, Rgb]): readonly [Rgb, Rgb] {
  const colour = new Color();
  const linear = (rgb: Rgb): Rgb => { colour.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace); return [colour.r, colour.g, colour.b]; };
  return [linear(tint[0]), linear(tint[1])];
}

export interface ClientDetailPorts {
  readonly root: Object3D;
  readonly scope: Scope;
  /** the compiled look materials, by `look.materials` id */
  readonly materials: ReadonlyMap<string, Material>;
  /** where the camera's player stands, read each frame */
  readonly viewer: () => { readonly x: number; readonly z: number };
  /** runs `run` every frame for the scope's life */
  readonly frame: (run: () => void) => void;
  /** the phone tier grows half the radius and half the slots */
  readonly phone: boolean;
}

/**
 * The rows' three files each: from the retained library, else read (format 0.7.0 does not require them in `library`, so a
 * valid shard may leave them out; the sdk puts them there).
 */
export async function detailLayerFiles(rows: readonly LookDetail[] | undefined, retained: ReadonlyMap<string, Uint8Array>, read: (hash: string) => Promise<Uint8Array>): Promise<ReadonlyMap<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const hash of new Set((rows ?? []).flatMap((row) => [row.mesh.file, row.mask, row.heights]))) files.set(hash, retained.get(hash) ?? await read(hash));
  return files;
}

/** Install every detail layer; returns the layers (empty when the look has none). */
export function installClientDetails(rows: readonly LookDetail[] | undefined, assets: ReadonlyMap<string, Uint8Array>, ports: ClientDetailPorts): readonly DetailLayer[] {
  if (rows === undefined || rows.length === 0) return [];
  const layers = rows.map((row) => {
    const file = (hash: string, what: string): Uint8Array => {
      const bytes = assets.get(hash);
      if (bytes === undefined) throw new Error(`Detail layer ${row.id}: its ${what} file ${hash.slice(0, 12)} is not in the library`);
      return bytes;
    };
    const files = { mesh: file(row.mesh.file, 'mesh'), mask: file(row.mask, 'mask'), heights: file(row.heights, 'heights') };
    const faults = detailFileFaults(row, files);
    if (faults.length > 0) throw new Error(`Detail layer refused: ${faults.join('; ')}`);
    const material = ports.materials.get(row.material);
    if (material === undefined) throw new Error(`Detail layer ${row.id}: material ${row.material} did not compile`);
    const source: DetailLayerSource = { ...row, tint: linearTint(row.tint) };
    const layer = new DetailLayer(source, files, material, { phone: ports.phone });
    ports.root.add(layer.mesh);
    ports.scope.onDispose(() => { layer.mesh.removeFromParent(); layer.dispose(); });
    return layer;
  });
  ports.frame(() => { const eye = ports.viewer(); for (const layer of layers) layer.update(eye); });
  return layers;
}
