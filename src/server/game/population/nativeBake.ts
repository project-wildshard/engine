import * as v from 'valibot';
import { nativeBodySchema, nativeGroundRecordSchema, nativeColliderRecordSchema, type NativeGroundStorage, type NativeArrayStorage } from '@wildshard/format/nativePhysics';
import type { AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import type { Collider } from '@dimforge/rapier3d-simd';
import { withOwner } from '@wildshard/engine/app/ownership';
import { solidReach } from '@wildshard/engine/physics/nearColliders';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { isChunkEdgeWall } from '@wildshard/engine/physics/terrain';
import { tagCollider, tagOf, type Material } from '@wildshard/engine/physics/surface';
import type { SimHost } from '@wildshard/engine/sim';

/** Raw native floor declaration. The producer's resolution stays part of admission. */
export interface NativeGroundRecord {
  readonly rows: number; readonly cols: number; readonly heights: NativeGroundStorage;
  readonly friction: number; readonly groups: number;
  readonly scale: { x: number; y: number; z: number };
  readonly at: { x: number; y: number; z: number };
}
/** Verified bytes lent from the native product before world construction. */
export interface NativeGroundBlock { readonly file: string; readonly bytes: Uint8Array }

/** Original collider buffers lent from named product files before native construction. */
export interface NativeColliderBlock { readonly file: string; readonly bytes: Uint8Array }

function colliderBytes(storage: NativeArrayStorage, blocks: ReadonlyMap<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  if (typeof storage === 'string') throw new Error('Native collider requires a named binary file');
  const bytes = blocks.get(storage.file);
  if (bytes === undefined) throw new Error('Missing native collider block');
  if (storage.byteOffset + storage.byteLength > bytes.byteLength) throw new Error('Native collider range exceeds block');
  return Uint8Array.from(bytes.subarray(storage.byteOffset, storage.byteOffset + storage.byteLength));
}

/** Decode an owned native heightfield, refusing a different lattice or world scale. */
export function nativeBakeGround(row: NativeGroundRecord, resolution: number, size: number, label: string, block?: NativeGroundBlock): NativeCollisionBake['ground'] {
  const storage = row.heights;
  if (typeof storage === 'string') throw new Error('Native floor requires a named binary file');
  if (block === undefined || block.file !== storage.file) throw new Error('Missing native floor block');
  const heights = new Float32Array(Uint8Array.from(block.bytes).buffer);
  if (heights.length !== resolution ** 2 || row.scale.x !== size || row.scale.z !== size || row.scale.y !== 1)
    throw new Error(`${label} baked floor is not its ${String(resolution)}² lattice`);
  return { heights, friction: row.friction, groups: row.groups, scale: row.scale, at: row.at };
}
/** Admit ordered actor metadata while checking each body's authored kind and variant. */
export function nativeBakeActors<T extends { readonly id: string; readonly kind: string; readonly variant: string; readonly spec: AnimalSimSpec }>(rows: readonly T[], label: string): readonly T[] {
  for (const row of rows) {
    if (row.spec.kind !== row.kind || row.spec.variant !== row.variant) throw new Error(`Divergent baked ${label} spec ${row.id}`);
  }
  return rows;
}

/** Native collision payload after strict admission and owned typed-buffer decode. */
export interface NativeCollisionBake {
  readonly ground: { readonly heights: Float32Array; readonly friction:number;readonly groups:number;
    readonly scale:{x:number;y:number;z:number};readonly at:{x:number;y:number;z:number} };
  readonly solids:readonly NativeCollisionSolid[];
}
/** Original native shape and query provenance; no placement or material inference. */
export interface NativeCollisionSolid {
  readonly shape:1|2|6|9;readonly groups:number;readonly friction:number;
  readonly at:readonly[number,number,number];readonly rot:readonly[number,number,number,number];
  readonly half?:readonly[number,number,number];readonly halfHeight?:number;readonly radius?:number;
  readonly points?:Float32Array;readonly indices?:Uint32Array;readonly material?:Material;
  readonly ownerId?:string;readonly owner?:string;
  /** Retained initial owner activity, resolved before native installation. */
  readonly enabled?:boolean;
}
/** Install the declared native lattice then its ordered solids under the actual
 * host scope. Optional record provenance preserves shared identities across
 * every collider and rebinds snapshot copies after native restore. */
export function installNativeCollision(host:Pick<SimHost,'physics'|'scope'|'onStep'>,bake:NativeCollisionBake,
  options:{readonly resolution:number;readonly omit?:readonly Material[];
    readonly provenance?:{readonly field:string;readonly step:string;readonly fallback:Material}}):ReadonlyMap<string,object|string> {
  const owners=new Map<string,object|string>(),policy=options.provenance,omit=new Set(options.omit);
  const omitted=(solid:NativeCollisionSolid):boolean=>solid.material!==undefined&&omit.has(solid.material)||omit.has('edge')&&solid.shape===1&&solid.half!==undefined&&(solid.material===undefined||solid.material==='edge')&&isChunkEdgeWall(solid.at,solid.half,solid.rot[3]);
  if(policy!==undefined){
    if(!/^[a-z][a-zA-Z0-9]{0,63}$/u.test(policy.field))throw new Error('Invalid native owner field');
    bake.solids.forEach(solid=>{const id=solid.ownerId;if(omitted(solid)||id===undefined||owners.has(id))return;
      if(!/^(?:piece|declared):[^\r\n]{1,256}$/u.test(id))throw new Error('Invalid baked world owner');
      owners.set(id,id.startsWith('piece:')?Object.freeze({[policy.field]:id}):id.slice('declared:'.length));});
  }
  const {R,world}=host.physics,g=bake.ground,n=options.resolution-1;
  withOwner(host.scope,()=>{
    const ground=world.createCollider(R.ColliderDesc.heightfield(n,n,g.heights,g.scale).setTranslation(g.at.x,g.at.y,g.at.z).setCollisionGroups(g.groups).setFriction(g.friction));
    tagCollider(ground,'ground');
    const build=(physics:Physics,solid:NativeCollisionSolid):Collider=>{
      const shapes=physics.R.ColliderDesc,desc=solid.shape===1&&solid.half!==undefined?shapes.cuboid(solid.half[0],solid.half[1],solid.half[2])
        :solid.shape===2&&solid.halfHeight!==undefined&&solid.radius!==undefined?shapes.capsule(solid.halfHeight,solid.radius)
        :solid.shape===6&&solid.points!==undefined&&solid.indices!==undefined?shapes.trimesh(solid.points,solid.indices)
        :solid.shape===9&&solid.points!==undefined?shapes.convexHull(solid.points):null;
      if(desc===null)throw new Error('Unbuildable native collider');
      return physics.world.createCollider(desc.setTranslation(solid.at[0],solid.at[1],solid.at[2]).setRotation({x:solid.rot[0],y:solid.rot[1],z:solid.rot[2],w:solid.rot[3]})
        .setCollisionGroups(solid.groups).setFriction(solid.friction));
    };
    const tagged=(physics:Physics,solid:NativeCollisionSolid,owner:unknown):Collider=>{
      const collider=build(physics,solid);
      if(solid.enabled!==undefined)collider.setEnabled(solid.enabled);
      if(policy!==undefined)tagCollider(collider,solid.material??policy.fallback,owner);
      else if(solid.material!==undefined)tagCollider(collider,solid.material,owner);
      return collider;
    };
    const near=host.physics.near;
    for(const solid of bake.solids){
      if(omitted(solid))continue;
      // A world held near its player is a grid cell, whose edge is the platform's (`gridLevel`): a shard's own page walls don't stand there.
      if(near!==null&&solid.material==='edge')continue;
      // With no policy a row names its owner itself: a tagged row's `owner`, or a piece row's `ownerId` (Nalati's bake,
      // SERVER-PARITY SS10b): `piece:<id>` as written, a `declared:` id by its name, the one a script looks up.
      const named=solid.ownerId===undefined?null:solid.ownerId.startsWith('declared:')?solid.ownerId.slice('declared:'.length):solid.ownerId;
      const owner=policy===undefined?solid.owner??named:solid.ownerId===undefined?null:owners.get(solid.ownerId);
      // A hull or mesh is most of a Rapier heap; a declared owner's solid stays, since a script may look it up. A `piece:`
      // `ownerId` names the page piece a solid stands for (Nalati's bake, SERVER-PARITY SS10b): no script looks it up. A tagged
      // row's own `owner` string is built at once, whatever it reads.
      if(near!==null&&(typeof owner!=='string'||solid.owner===undefined&&solid.ownerId?.startsWith('piece:')===true)&&solid.enabled!==false&&(solid.shape===9||solid.shape===6)&&solid.points!==undefined){
        near.hold({x:solid.at[0],z:solid.at[2],reach:solidReach(solid.points),make:physics=>withOwner(host.scope,()=>tagged(physics,solid,owner))});
        continue;
      }
      tagged(host.physics,solid,owner);
    }
  });
  if(policy!==undefined){
    host.onStep(policy.step,()=>undefined,{snapshot:()=>1,restore:value=>{if(value!==1)throw new Error('Invalid world-tag continuation');},
      physicsRestored:()=>{host.physics.world.forEachCollider(collider=>{const tag=tagOf(collider),owner=tag?.owner;
        if(tag===undefined||owner===null||typeof owner!=='object'||!(policy.field in owner))return;
        const id:unknown=Reflect.get(owner,policy.field);if(typeof id!=='string'||!owners.has(id))throw new Error('Saved native world owner is missing');
        tagCollider(collider,tag.material,owners.get(id));});}});
    host.scope.onDispose(()=>{owners.clear();});
  }
  return owners;
}

/** Validated wire collider before its binary channels become owned typed views. */
export type NativeColliderRecord<S extends 1|2|6|9 = 1|2|6|9> = Omit<NativeCollisionSolid,'points'|'indices'|'shape'> & {
  readonly shape:S;readonly body?:number|null;readonly vertices?:NativeArrayStorage;readonly indices?:NativeArrayStorage;
};

/** Ordered body recipe captured at native boot; no body or new random stream is created by intake. */
export interface NativeBakedActor {
  readonly id: string; readonly kind: string; readonly variant: string; readonly herd: number;
  readonly spec: AnimalSimSpec; readonly seed: number; readonly scale: number; readonly scripted: boolean;
}
/** Common native world payload; encounter, shelter and other owner metadata is admitted separately. */
export interface NativePhysicsBake extends NativeCollisionBake {
  readonly actors: readonly NativeBakedActor[];
  readonly parked: readonly Omit<NativeBakedActor, 'herd' | 'scripted'>[];
  readonly herds: readonly { readonly kind: string; readonly members: readonly string[] }[];
}
/** Strict one-time intake and independent solid parsing over the same declared provenance schema. */
export interface NativeBakeReader<E> {
  readonly read: () => NativePhysicsBake & E;
  readonly solid: (input: unknown) => NativeCollisionSolid;
}
/** Compose the existing native lattice, collider and actor readers. Cache only a fully admitted result, and keep
 * compiled metadata schemas explicit. Failed parsing never publishes a memo.
 */
function nativeBakeReader<E extends object>(input: unknown, options: {
  readonly label: string; readonly resolution: number; readonly size: number; readonly parked: boolean;
  readonly spec: v.GenericSchema<unknown, AnimalSimSpec>;
  readonly solid: v.GenericSchema<unknown, NativeColliderRecord>;
  readonly extra: v.GenericSchema<unknown, E>;
  readonly groundBlock?: NativeGroundBlock;
  readonly colliderBlocks:ReadonlyMap<string,Uint8Array>;
}): NativeBakeReader<E> {
  const finite = v.pipe(v.number(), v.finite());
  const body = { id: v.string(), kind: v.string(), variant: v.string(), spec: options.spec, seed: finite, scale: finite };
  const schema = v.object({ version: v.literal(1), ground: nativeGroundRecordSchema(options.resolution,true), solids: v.array(options.solid),
    actors: v.array(v.strictObject({ id: body.id, kind: body.kind, variant: body.variant, herd: finite, spec: body.spec, seed: finite, scale: finite, scripted: v.boolean() })),
    parked: v.exactOptional(v.array(v.strictObject(body))),
    herds: v.array(v.strictObject({ kind: v.string(), members: v.array(v.string()) })) });
  const decodeSolid = ({ vertices, indices, body: _body, ...rest }: NativeColliderRecord): NativeCollisionSolid => {
    if ((rest.shape === 6 || rest.shape === 9) !== (vertices !== undefined) || (rest.shape === 6) !== (indices !== undefined)) throw new Error(`Unbuildable baked ${options.label} collider`);
    return { ...rest, ...(vertices === undefined ? {} : { points: new Float32Array(colliderBytes(vertices,options.colliderBlocks).buffer) }), ...(indices === undefined ? {} : { indices: new Uint32Array(colliderBytes(indices,options.colliderBlocks).buffer) }) };
  };
  let parsed: (NativePhysicsBake & E) | null = null;
  return {
    solid: value => decodeSolid(v.parse(options.solid, value)),
    read: () => {
      if (parsed !== null) return parsed;
      const bake = v.parse(schema, input), extra = v.parse(options.extra, input);
      if (Object.keys(extra).some(key => ['ground', 'solids', 'actors', 'parked', 'herds'].includes(key))) throw new Error('Native bake metadata shadows a world field');
      if (options.parked && bake.parked === undefined) throw new Error(`Missing baked ${options.label} parked roster`);
      const result = { ...extra, ground: nativeBakeGround(bake.ground, options.resolution, options.size, options.label,options.groundBlock),
        solids: bake.solids.map(decodeSolid), actors: nativeBakeActors(bake.actors, options.label),
        parked: nativeBakeActors(bake.parked ?? [], options.label), herds: bake.herds };
      const ids = new Set(result.actors.map(actor => actor.id));
      if (ids.size !== result.actors.length || !result.herds.every(herd => herd.members.every(id => ids.has(id)))) throw new Error('Baked population roster is not one id per body');
      parsed = result;
      return result;
    },
  };
}

const finite=v.pipe(v.number(),v.finite());
const lattice={label:v.pipe(v.string(),v.minLength(1),v.maxLength(128)),resolution:v.pipe(finite,v.integer(),v.minValue(2)),size:v.pipe(finite,v.minValue(0.001))};
const nativeIntake=v.strictObject({...lattice,parked:v.boolean(),rig:v.picklist(['segments','axis']),provenance:v.picklist(['piece','tagged']),
  shapes:v.pipe(v.array(v.picklist([1,2,6,9])),v.minLength(1),v.maxLength(4),v.check(shapes=>new Set(shapes).size===shapes.length))});
/** Public native admission accepts only stock data profiles, never a validator
 * or owner-check callback. Owner metadata uses named Product.json files. */
export function createNativeBakeReader(input:unknown,rows:unknown,groundBlock?:NativeGroundBlock,
  colliderBlocks:readonly NativeColliderBlock[]=[]):NativeBakeReader<object>{
  const row=v.parse(nativeIntake,rows),options={...row,spec:nativeBodySchema(row.rig),solid:nativeColliderRecordSchema(row.shapes,row.provenance,true)};
  if(groundBlock!==undefined&&!(groundBlock.bytes instanceof Uint8Array))throw new Error('Invalid native floor bytes');
  const blocks = new Map<string, Uint8Array>();
  for (const block of colliderBlocks) {
    if (blocks.has(block.file) || !(block.bytes instanceof Uint8Array)) throw new Error('Invalid or duplicate native collider block');
    blocks.set(block.file, block.bytes);
  }
  return nativeBakeReader(input,{...options,extra:v.object({}),colliderBlocks:blocks,...(groundBlock===undefined?{}:{groundBlock})});
}
