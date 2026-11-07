import { Color, Vector3, type Vector4 } from 'three';
import * as v from 'valibot';
import { LightPoolRowSchema, type LightPoolRow } from '@wildshard/format/lightEmitters';

/** Renderer-private numeric light sources. Rows own identity; callers may address a switch only by id. */
export class LightEmitters {
  private readonly rows: readonly LightPoolRow[];
  private readonly active = new Map<string, boolean>();
  private readonly uniform: { readonly value: readonly Vector4[] } | undefined;
  constructor(input: readonly LightPoolRow[], uniform?: { readonly value: readonly Vector4[] }) {
    this.uniform = uniform;
    this.rows = v.parse(v.pipe(v.array(LightPoolRowSchema), v.maxLength(16384),
      v.check(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Unique emitter ids')), input);
    if (uniform !== undefined && uniform.value.length < this.rows.length) throw new Error('Emitter uniform capacity exceeded');
    for (const row of this.rows) this.active.set(row.id, row.initially);
    this.write();
  }
  set(id: string, lit: boolean): void {
    if (!this.active.has(id)) throw new Error(`Missing light emitter: ${id}`);
    this.active.set(id, lit); this.write();
  }
  /** Exact linear-colour sources for an irradiance bake, in declared order. */
  volume(): { at: Vector3; color: Color; k: number; r: number; cut: number }[] {
    return this.rows.map(row => ({ at: new Vector3(...row.at), color: new Color().setRGB(...row.colour),
      k: this.active.get(row.id) === true ? row.gain : 0, r: row.radius, cut: row.cut }));
  }
  private write(): void {
    if (this.uniform === undefined) return;
    for (const [i, point] of this.uniform.value.entries()) {
      const row = this.rows[i];
      if (row === undefined) point.set(0, 0, 0, 0);
      else point.set(...row.at, this.active.get(row.id) === true ? row.gain : 0);
    }
  }
}
