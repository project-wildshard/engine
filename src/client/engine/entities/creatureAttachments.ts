import { Group, Mesh, type BufferGeometry, type Material, type Object3D } from 'three';

/**
 * ONE-FORMAT CC30c: a creature's socket attachments on its page body, the boss socket rig's way (`BossSocketRig`: a
 * group per attachment on its bone, one mesh per part) opened to every species. Each frame the actor channels (wire 1.1
 * animal fields 25 to 28, the server's) decide what shows: `when` while its channel is at `at` or above, and a `part`
 * attachment hides once its break channel reads 1. Geometry and materials are the shard's, shared by every body.
 */
export interface SpeciesAttachment {
  readonly id: string;
  /** the bone it hangs on, and its offset in the bone's frame (a skeleton socket's own offset included) */
  readonly bone: string;
  readonly at: readonly [number, number, number];
  readonly meshes: readonly { readonly id: string; readonly geometry: BufferGeometry; readonly material: Material }[];
  /** shown while channel `index` is at `at` or above */
  readonly when?: { readonly index: number; readonly at: number };
  /** the channel a part's break sets to 1: hidden from then on */
  readonly part?: number;
}

/** One body's attachments, hung on its bones. */
export class AttachmentRig {
  private readonly groups: { readonly row: SpeciesAttachment; readonly group: Group }[];
  constructor(rows: readonly SpeciesAttachment[], bone: (name: string) => Object3D | undefined) {
    const parents = rows.map(row => { const parent = bone(row.bone); if (parent === undefined) throw new Error(`Missing creature attachment bone ${row.bone}`); return parent; });
    this.groups = rows.map((row, i) => {
      const group = new Group(); group.name = row.id; group.position.set(...row.at);
      for (const part of row.meshes) { const view = new Mesh(part.geometry, part.material); view.name = part.id; view.castShadow = false; group.add(view); }
      parents[i]?.add(group);
      return { row, group };
    });
  }
  /** Show each attachment as the body's channels say. */
  update(channels: readonly number[]): void {
    for (const { row, group } of this.groups) {
      const shown = row.when === undefined || (channels[row.when.index] ?? 0) >= row.when.at;
      group.visible = shown && (row.part === undefined || (channels[row.part] ?? 0) < 1);
    }
  }
  dispose(): void { for (const { group } of this.groups) group.removeFromParent(); }
}
