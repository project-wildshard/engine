import type {BinaryFileReader} from './binarySource';
import * as v from 'valibot';
import type { BufferGeometry, Material, Object3D } from 'three';
import { creatureFactory } from '@wildshard/engine/models/creature';
import { defineModel, type ModelContext, type ModelDef } from '@wildshard/engine/models/model';
import { MountedSpecimenSchema, MountedSpecimenSeatSchema, type MountedSpecimenSeatRows } from '@wildshard/format/mountedSpecimenRows';
import { loadFirstPartyProduct } from '../shardfile/runtimeProduct';
import { seatedFigureView,prepareSeatedFigure } from '../riding/seatedFigure';

/** The factory's ports (a test seam; `defineMountedSpecimen` is the real ones): the named product's JSON read, the
 *  species rig (its joints and body) at a fur tint, the seated figure handing each decoded resource to its owner. */
export interface MountedSpecimenPorts {
  readonly product: (slug: string) => Promise<BinaryFileReader & { readonly json: (name: string) => Promise<unknown> }>;
  readonly rig: (ctx: ModelContext, species: string, variant: string, tint: number) => { readonly bones: Readonly<Record<string, Object3D>>; readonly mesh: Object3D };
  readonly figure: (rows: MountedSpecimenSeatRows, own: (resource: BufferGeometry | Material) => void, files?:ReadonlyMap<string,Uint8Array>) => { readonly root: Object3D };
}
const PORTS: MountedSpecimenPorts = {
  product: slug => loadFirstPartyProduct(slug),
  rig: (ctx, species, variant, tint) => { const factory = creatureFactory(ctx); return factory.instantiate(factory.model(species, variant), tint); },
  figure: (rows, own,files) => seatedFigureView(rows, own,files),
};
/** A specimen of a figure seated on a species rig (G530 O1: one shard's mounted rider): the rig at its fur tint (0..1),
 *  the figure on the declared joint as the ride seats it (riding/seatedFigure). Rows only, plain JSON before the strict
 *  row; the profile is the product file the row names, admitted again (`MountedSpecimenSeatSchema`) before any build,
 *  and a rig without the seat's joint refuses before the figure is made; the figure's decoded shapes and material belong
 *  to the specimen card's owner. */
export const defineMountedSpecimen: (input: unknown) => ModelDef<object> = mountedSpecimens(PORTS);
/** `defineMountedSpecimen` over the given ports. */
export function mountedSpecimens(ports: MountedSpecimenPorts): (input: unknown) => ModelDef<object> { return input => {
  const row = v.parse(MountedSpecimenSchema, input);
  let prepared: MountedSpecimenSeatRows | null = null,files:ReadonlyMap<string,Uint8Array>=new Map();
  const { surface, variants, seed, specimenYaw, ...metadata } = row.model;
  return defineModel<object>({ ...metadata,
    ...(surface === undefined ? {} : { surface }), ...(variants === undefined ? {} : { variants }),
    ...(seed === undefined ? {} : { seed }), ...(specimenYaw === undefined ? {} : { specimenYaw }),
    prepare: async () => { const product=await ports.product(row.slug),seat=v.parse(MountedSpecimenSeatSchema,await product.json(row.json));files=await prepareSeatedFigure(product,seat);prepared=seat; },
    build: ctx => {
      if (prepared === null) throw new Error('Mounted specimen is not prepared');
      const rig = ports.rig(ctx, row.species, row.variant, row.tint), seat = rig.bones[prepared.mount];
      if (seat === undefined) throw new Error('Mounted specimen rig has no seat joint');
      const owner = ctx.specimenScope;
      seat.add(ports.figure(prepared, resource => { owner?.own(resource); },files).root); return rig.mesh;
    },
  });
}; }
