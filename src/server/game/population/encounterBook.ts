/** An encounter's species from the admitted book: what a world needs to raise a body the population never boots, and the contact
 *  joints and custom pose that body strikes with. Only metadata is read here: no actor, entropy or outcome is made. */
import * as v from 'valibot';
import { SpeciesActorsFileSchema } from '@wildshard/format/speciesBookRows';
import { nativeBodySchema } from '@wildshard/format/nativePhysics';
import { parsePackedCreatureLooks } from '@wildshard/format/speciesLooks';
import { variantMods } from '@wildshard/engine/entities/species/registry';
import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import { numericCreaturePoseFromBook } from '../../../shared/game/plugin/channelPrograms';
import { creatureFrame } from '../../../shared/game/plugin/creatureFrame';
import type { NativeCreaturePoseRecipe } from '../../../shared/game/plugin/animation';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import type { EncounterIntake } from './encounterIntake';

/** Additional encounter recipes come from the page's complete admitted book.
 * This only preflights metadata: no actor, entropy or outcome is created. */
export async function readEncounterIntake(product:Pick<ShardProduct,'json'>,kinds:readonly string[],file='actors/sheep.json'):Promise<EncounterIntake> {
  if(kinds.length>16||new Set(kinds).size!==kinds.length)throw new Error('Duplicate native arena species');
  const actors=v.parse(SpeciesActorsFileSchema,await product.json(file));
  const rows=kinds.map(kind=>{const row=actors.species.lookBook.rows.find(candidate=>candidate.metadata.kind===kind);
    if(row===undefined||row.metadata.flight!==undefined)throw new Error('Arena has no admitted grounded species');return row;});
  const recipes=rows.flatMap(entry=>[...entry.metadata.variants,...entry.metadata.spawnOnly??[]].map(variant=>{
    const mapping=entry.variants[variant.id];if(mapping===undefined)throw new Error('Arena variant lost its body mapping');
    const body=actors.species.packedBodies.rows.find(row=>row.kind===entry.family&&row.variant===mapping.body);
    const skeleton=body===undefined?undefined:actors.species.packedBodies.skeletons[body.skeleton];
    if(skeleton===undefined)throw new Error('Arena variant lost its actual skeleton dimensions');
    const species=entry.metadata;
    return v.parse(nativeBodySchema('axis'),{kind:species.kind,label:variant.label||species.label,variant:variant.id,rarity:variant.rarity,
      hp:variant.hp??species.tuning?.hp??(species.aggressive===true?100:60),aggressive:species.aggressive??false,
      dims:structuredClone(skeleton.dims),mods:variantMods(species,variant),...(species.lockable===undefined?{}:{lockable:species.lockable})});
  }));
  return {species:rows.map(row=>row.metadata),recipes};
}

/** Where the books stand in a shard's product. */
const ACTOR_BOOKS={actors:'actors/sheep.json',looks:'actors/species-looks.json'};
const finite=v.pipe(v.number(),v.finite());
const Bones=v.pipe(v.array(v.object({name:v.string(),parent:v.nullable(v.string()),pos:v.tuple([finite,finite,finite])})),v.maxLength(32));
/** Native contact joints and exact custom animations from the admitted page
 * body and look books, never approximate target capsules. */
export async function readEncounterPoses(product:Pick<ShardProduct,'json'>,kinds:readonly string[],files:{readonly actors:string;readonly looks:string}=ACTOR_BOOKS):Promise<{
  rows:readonly {kind:string;variant:string;pose:NativeCreaturePoseRecipe}[];
  animations:(ground:(x:number,z:number)=>number)=>ReadonlyMap<string,(context:AnimalRigContext)=>void>;
}> {
  const [actors,looks]=await Promise.all([
    product.json(files.actors).then(input=>v.parse(SpeciesActorsFileSchema,input)),
    product.json(files.looks).then(parsePackedCreatureLooks),
  ]);
  const selected=kinds.map(kind=>{
    const body=actors.species.lookBook.rows.find(row=>row.metadata.kind===kind),look=looks.rows.find(row=>row.kind===kind);
    if(body===undefined||look===undefined||look.rig!=='custom'||look.postPose!==undefined||look.lift!==undefined
      ||(look.animate===undefined)===(look.frame===undefined))throw new Error('Arena requires its original custom pose');
    return {kind,body,look};
  });
  const rows=selected.flatMap(({kind,body,look})=>[...body.metadata.variants,...body.metadata.spawnOnly??[]].map(variant=>{
    const mapping=body.variants[variant.id],packed=mapping===undefined?undefined:
      actors.species.packedBodies.rows.find(row=>row.kind===body.family&&row.variant===mapping.body);
    const skeleton=packed===undefined?undefined:actors.species.packedBodies.skeletons[packed.skeleton];
    if(skeleton===undefined)throw new Error('Arena contact body has no actual skeleton');
    const bones=v.parse(Bones,skeleton.bones);
    if(new Set(bones.map(bone=>bone.name)).size!==bones.length)throw new Error('Duplicate arena contact joint');
    const pose:NativeCreaturePoseRecipe={custom:true,deathSplay:false,
      ...(look.gait===undefined?{}:{gait:look.gait}),...(look.stance===undefined?{}:{pose:look.stance}),
      joints:bones.map((bone,index)=>{
        const parent=bone.parent===null?-1:bones.findIndex(candidate=>candidate.name===bone.parent),rest=bones[parent];
        if(bone.parent!==null&&(parent<0||parent>=index))throw new Error('Arena skeleton lost its original parent order');
        return {name:bone.name,parent,position:[bone.pos[0]-(rest?.pos[0]??0),bone.pos[1]-(rest?.pos[1]??0),bone.pos[2]-(rest?.pos[2]??0)],
          order:'XYZ',scale:[1,1,1]};
      })};
    return {kind,variant:variant.id,pose};
  }));
  return {rows,animations:ground=>new Map(selected.map(({kind,look})=>{
    if(look.animate!==undefined)return [kind,numericCreaturePoseFromBook(looks,look.animate)];
    const frame=look.frame===undefined?undefined:looks.frames[look.frame];
    if(frame===undefined)throw new Error('Arena frame is absent from its real look book');
    return [kind,creatureFrame(frame,ground)];
  }))};
}
