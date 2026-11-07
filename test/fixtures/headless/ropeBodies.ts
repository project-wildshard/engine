import {rideable} from '../../../src/shared/engine/physics/CharacterMotor';
import {tagOf} from '../../../src/shared/engine/physics/surface';
import {isSimHostRestoring} from '../../../src/shared/engine/sim/snapshot';
import {RopeChain} from '../../../src/shared/engine/physics/ropeChain';
import type {SimHost} from '../../../src/server/engine/sim';
import type {ShardProduct} from '../../../src/shared/game/shardfile/shardProduct';
import type {WorldAssemblyStage} from '@wildshard/format/worldAssembly';

const restoredWalkBodies=new WeakSet<SimHost>();
/** The native restore transaction already owns its saved rope bodies/joints.
 * Reinstalling their construction on the first framed request duplicates them.
 * This fixture loan is allowed only while the real full restore is installing. */
export function retainRestoredWalkBodies(host:SimHost):void {
  if(!isSimHostRestoring(host))throw new Error('Walk continuation requires a native restore transaction');
  restoredWalkBodies.add(host);
}

/** Static native proof rows omit dynamic rope planks. Physics walks install
 * the actual engine chain from the same admitted deck/chain stages as play.
 * The chain consumes admitted rest poses, as RopeDeck.chainSpec does; its
 * physics API has no terrain query. The model's separate analytic-ground
 * admission remains in RopeDeckSite. No drawn or guessed deck enters Node. */
export function installWalkRopeBodies(host:SimHost,product:ShardProduct|undefined):()=>void {
  const chains:RopeChain[]=[];
  if(product?.has('client/plan')!==true)return ()=>{ /* No admitted rope inventory. */ };
  const decks=new Map<string,Extract<WorldAssemblyStage,{kind:'rope-deck'}>>();
  try {
    for(const feature of product.section('client/plan').features){
      if(feature.kind!=='world.assembly')continue;
      for(const stage of feature.rows.stages){
        if(stage.kind==='rope-deck'){
          if(decks.has(stage.id))throw new Error('Duplicate native rope deck');decks.set(stage.id,stage);
        }else if(stage.kind==='rope-chain'){
          const deck=decks.get(stage.deck);if(deck===undefined)throw new Error('Native rope chain needs its declared deck');
          const {span,site}=deck,rows=site.deck,key=JSON.stringify([span.a,span.b,span.width??rows.width,span.sag??rows.sag]);
          const facts=site.spans.find(row=>row.key===key);if(facts===undefined)throw new Error('Unbaked native rope span');
          if(facts.segments.length>rows.maxSegments)throw new Error('Native rope deck exceeds its segment bound');
          if(restoredWalkBodies.has(host)){
            const bodies=new Map<number,ReturnType<typeof host.physics.world.getRigidBody>>();
            host.physics.world.forEachCollider(collider=>{
              const tag=tagOf(collider),owner=tag?.owner,body=collider.parent();
              if(tag?.material==='wood'&&owner!==null&&typeof owner==='object'&&'id' in owner&&'name' in owner
                &&owner.id===rows.owner.id&&owner.name===rows.owner.name&&body?.isDynamic()===true)bodies.set(body.handle,body);
            });
            if(bodies.size!==facts.segments.length)throw new Error('Saved native rope chain differs from its admitted segment count');
            // Rapier owns the saved bodies/joints; the motor's JS identity loan
            // must be rebound to those exact bodies, without constructing any.
            for(const body of bodies.values())rideable(body);
            continue;
          }
          const copyOwner=()=>({...rows.owner});
          const chain=new RopeChain(host.physics,{segments:structuredClone(facts.segments),hx:facts.width/2+rows.margin,hy:rows.halfY,mass:rows.mass,
            owners:facts.segments.map(copyOwner)});chains.push(chain);
          host.onStep(stage.capture,()=>{chain.capture();},undefined,'afterBodies');
        }
      }
    }
  }catch(error){for(const chain of chains)chain.dispose();throw error;}
  return ()=>{for(const chain of chains)chain.dispose();};
}
