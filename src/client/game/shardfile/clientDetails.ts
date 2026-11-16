/**
 * A shard's detail layers on the page (meta SHARD-SOURCE AP32d1): each `look.details` row (format v0.7.0, AP32a) becomes one
 * `DetailLayer` (AP32b) under the shard's root, drawn with its look material and following the viewer each frame.
 *
 *   installClientDetails(source.look.details, assets, { root, scope, materials, viewer, frame, phone });
 *
 * With `trample` (meta SHARD-SOURCE SS7) every layer bends on the page's trample field, and when the page owns the field the
 * frame pushes each mover (the player, then the creatures) and advances it: the cards part round a body and spring back.
 *
 * The three files are library binaries (the charged library: the page has them before the world draws). A row whose files
 * do not match its counts, or whose material did not compile, is refused loudly: never a silently missing meadow.
 */
import { SRGBColorSpace, Color, type Material, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { detailFileFaults, type LookDetail } from '@wildshard/format/look-details';
import { DetailLayer, type DetailTrample } from '@wildshard/engine/world/detailLayer';
import type { DetailLayerSource } from '@wildshard/engine/world/detailRing';

type Rgb = readonly [number, number, number];

/** A body the grass parts round: `radius` metres (the trample field's push radius; the bend reaches 1.6 times it). */
export interface DetailMover { readonly id: string; readonly x: number; readonly z: number; readonly radius: number }

/** The page's trample field for the layers (the engine's `systems/looks/trample.ts`). */
export interface DetailTramplePort extends DetailTrample {
  readonly field: { push: (x: number, z: number, radius: number, strength?: number, vx?: number, vz?: number) => void; update: (dt: number, playerPos: { x: number; z: number }) => void };
  /** the movers to push this frame, the player first; null when another system on the page owns the field (it pushes and
   *  advances it) or no push should land (a practice room is open), so the layers only bend on it. Asked every frame, so
   *  the owner can be settled once every plan phase has had its turn to register one. */
  readonly movers: () => Iterable<DetailMover> | null;
}

/** A step faster than this (m/s) is a teleport or a respawn: pushed with no velocity (Grass.ts's 30 m/s). */
const TELEPORT_SPEED = 30;

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
  /** runs `run` every frame for the scope's life, with the frame's seconds */
  readonly frame: (run: (dt: number) => void) => void;
  /** the phone tier grows half the radius and half the slots */
  readonly phone: boolean;
  /** SS7: the field the cards bend on; omitted, they only sway */
  readonly trample?: DetailTramplePort;
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
    const layer = new DetailLayer(source, files, material, { phone: ports.phone, ...(ports.trample === undefined ? {} : { trample: ports.trample }) });
    ports.root.add(layer.mesh);
    ports.scope.onDispose(() => { layer.mesh.removeFromParent(); layer.dispose(); });
    return layer;
  });
  const movers = ports.trample?.movers, field = ports.trample?.field, last = new Map<string, { x: number; z: number; seen: boolean }>();
  ports.frame((dt) => {
    const eye = ports.viewer();
    for (const layer of layers) layer.update(eye);
    const now = movers?.() ?? null;
    if (now === null || field === undefined) return;
    let player: { x: number; z: number } | null = null;
    for (const seen of last.values()) seen.seen = false;
    for (const mover of now) {
      const before = last.get(mover.id);
      let vx = before === undefined || dt <= 0 ? 0 : (mover.x - before.x) / dt, vz = before === undefined || dt <= 0 ? 0 : (mover.z - before.z) / dt;
      if (vx * vx + vz * vz > TELEPORT_SPEED * TELEPORT_SPEED) { vx = 0; vz = 0; }
      field.push(mover.x, mover.z, mover.radius, 1, vx, vz);
      if (before === undefined) last.set(mover.id, { x: mover.x, z: mover.z, seen: true }); else { before.x = mover.x; before.z = mover.z; before.seen = true; }
      player ??= mover;
    }
    // a mover missing this frame is forgotten, so coming back somewhere else is not read as a stride
    for (const [id, seen] of last) if (!seen.seen) last.delete(id);
    field.update(dt, player ?? eye);
  });
  return layers;
}
