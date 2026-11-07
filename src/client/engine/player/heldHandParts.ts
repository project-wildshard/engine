import { BufferAttribute, Group, Matrix4, Mesh, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';

/** One borrowed fist with an optional borrowed rigid/free sleeve. No geometry is built or copied. */
export interface HeldHandPartRow {
  readonly name: string;
  readonly geometry: BufferGeometry; readonly material: Material;
  readonly sleeve: BufferGeometry | null; readonly sleeveMaterial?: Material;
  readonly wrist: Vector3; readonly dir: Vector3;
  readonly elbow?: Vector3 | readonly [number, number, number] | undefined;
  /** A borrowed articulated parent, for independently posed hands. Default: the owned group. */
  readonly parent?: Object3D;
  /** The wrist's frame for a free sleeve. Default: the fist's own quaternion/position. */
  readonly frame?: Object3D;
}
export interface HeldHandPartsOptions {
  readonly name?: string; readonly viewmodelOnly?: boolean;
  /** Opt-in preparation of the existing shared viewmodel material queue. */
  readonly transparentMaterials?: readonly Material[];
}
/** Bounded held-part assembly and sleeve publication. Borrowed backing and external rig parents survive disposal.
 * Local grip solving, pose clocks, palettes and baked-key admission remain with the caller.
 */
export class HeldHandParts {
  readonly group: Group = new Group();
  private readonly up = new Vector3(0, 1, 0);
  private readonly fists: Mesh[] = [];
  private readonly extra: Mesh[] = [];
  private readonly sleeves: { fist: Mesh; mesh: Mesh; wrist: Vector3; elbow: Vector3; frame: Object3D | undefined }[] = [];
  private readonly wrist = new Vector3(); private readonly elbow = new Vector3(); private readonly inverse = new Matrix4();
  constructor(parent: Object3D, rows: readonly HeldHandPartRow[], options: HeldHandPartsOptions = {}) {
    if (rows.length === 0 || rows.length > 8) throw new RangeError('Held hand parts require 1..8 rows');
    this.group.name = options.name ?? 'held-hands';
    if (options.viewmodelOnly === true) this.group.userData['viewmodelOnly'] = true;
    for (const material of options.transparentMaterials ?? []) { material.transparent = true; material.depthWrite = true; }
    for (const row of rows) { const fist = new Mesh(row.geometry, row.material); fist.name = row.name; this.fists.push(fist); }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], fist = this.fists[i]; if (row === undefined || fist === undefined) throw new Error('Missing held hand part');
      if (row.sleeve === null) continue;
      const mesh = new Mesh(row.sleeve, row.sleeveMaterial ?? row.material); mesh.name = `${fist.name}-sleeve`;
      this.prepare(mesh, options.viewmodelOnly === true);
      if (row.elbow !== undefined) {
        const elbow = row.elbow instanceof Vector3 ? row.elbow : new Vector3(...row.elbow);
        this.sleeves.push({ fist, mesh, wrist: row.wrist, elbow, frame: row.frame }); this.group.add(mesh);
      } else { mesh.position.copy(row.wrist); mesh.quaternion.setFromUnitVectors(this.up, row.dir); fist.add(mesh); }
      this.extra.push(mesh);
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], fist = this.fists[i]; if (row === undefined || fist === undefined) throw new Error('Missing held hand part');
      this.prepare(fist, options.viewmodelOnly === true); (row.parent ?? this.group).add(fist);
    }
    parent.add(this.group);
  }
  private prepare(mesh: Mesh, viewmodelOnly: boolean): void {
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.renderOrder = 1000;
    if (viewmodelOnly) mesh.userData['viewmodelOnly'] = true;
  }
  fist(index: number): Mesh { const fist = this.fists[index]; if (fist === undefined) throw new RangeError('Unknown held hand'); return fist; }
  /** Camera-space elbows are transformed into the model; an explicit frame borrows an independent rig's matrix.
   * Callers with live elbow projection mutate their borrowed vector first. Optional scale preserves rig sleeve scaling.
   */
  aim(model: Object3D, scale?: number): void {
    if (this.sleeves.length === 0 || !this.group.visible) return;
    model.updateMatrix(); this.inverse.copy(model.matrix).invert();
    for (const sleeve of this.sleeves) {
      const wrist = this.wrist.copy(sleeve.wrist);
      if (sleeve.frame === undefined) wrist.applyQuaternion(sleeve.fist.quaternion).add(sleeve.fist.position);
      else { sleeve.frame.updateMatrix(); wrist.applyMatrix4(sleeve.frame.matrix); }
      const direction = this.elbow.copy(sleeve.elbow).applyMatrix4(this.inverse).sub(wrist).normalize();
      sleeve.mesh.position.copy(wrist); sleeve.mesh.quaternion.setFromUnitVectors(this.up, direction);
      sleeve.mesh.visible = sleeve.fist.visible;
      if (scale !== undefined) sleeve.mesh.scale.setScalar(scale);
    }
  }
  /** Counts existing borrowed backing, including shared/indexed channels, without changing ownership. */
  get cost(): { draws: number; tris: number; verts: number; bytes: number } {
    let tris = 0, verts = 0, bytes = 0;
    const meshes = [...this.fists, ...this.extra];
    for (const mesh of meshes) {
      const geometry = mesh.geometry, index = geometry.getIndex();
      tris += (index ? index.count : geometry.getAttribute('position').count) / 3;
      verts += geometry.getAttribute('position').count;
      for (const attribute of Object.values(geometry.attributes)) if (attribute instanceof BufferAttribute) bytes += attribute.array.byteLength;
      if (index) bytes += index.array.byteLength;
    }
    return { draws: meshes.length, tris, verts, bytes };
  }
  dispose(): void {
    for (const fist of this.fists) if (fist.parent !== this.group) fist.removeFromParent();
    this.group.removeFromParent();
  }
}
