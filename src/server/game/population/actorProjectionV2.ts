import { parseActorProjectionV2,type ActorProjectionV2Rows } from '@wildshard/format/actorProjectionV2';
import { ObservationColumnsV2,type V2ColumnOwners } from '@wildshard/engine/script/observationColumnsV2';
import type { App } from '@wildshard/engine/app/app';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { SpeciesDef,ThinkCtx } from '@wildshard/engine/entities/species/registry';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import type { Scope } from '@wildshard/engine/app/scope';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import type { Rng } from '@wildshard/engine/core/rng';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import type { Vector3 } from 'three';

/** Original native actor authority, lent at its existing decision slot. Group
* simulations use this same per-member surface; their own continuation and
* roster order remain with the group owner. */
export type ActorProjectionContext<A extends AnimalSim> = Pick<ThinkCtx,'dt'|'t'|'player'|'calm'|'hurt'|'sound'|'playerSpeed'> & {
  steer:(actor:A,yaw:number,speed:number,turn:number)=>void;
  reach:(actor:A)=>boolean;
  pathYaw?:(actor:A,x:number,z:number,every:number)=>number;
  confine?:(actor:A)=>void;
};
export interface ActorProjectionOwner extends Pick<V2ColumnOwners,'scope'|'environment'|'clock'|'weather'|'herds'|'taming'|'mount'|'crowd'|'rosters'> {
  readonly random?:Rng;
  readonly observed?:V2ColumnOwners['observed'];
  readonly group:string;
  readonly slot:number;
  readonly identity:string
}
type Operation=NonNullable<ActorProjectionV2Rows['step']>['operations'][number];
type Scalar=Extract<Operation,{kind:'memory'}>['value'];
function number(value:number|undefined):number{
  if(value===undefined||!Number.isFinite(value))throw new Error('Missing actor projection scalar');
  return value;
}
/** H4 actor callbacks over the existing body, memory and decision slot. Cold
* construction admits metadata only. No body, continuation or clock is owned. */
export class ActorProjectionV2 {
  private readonly rows;
  private readonly page:Pick<App,'levelScope'|'equipment'|'events'>|undefined;
  private readonly contacts=new StrikeRunner();
  private readonly strikes=new Map<Operation,ReturnType<typeof strikeFromData>>();
  private scope:Scope|null=null;
  private programme:{scope:Scope;value:ReturnProgram}|null=null;
  private columns:readonly ObservationColumnsV2[]=[];
  readonly binding:Pick<SpeciesDef,'kind'|'think'|'damageMul'>;
  constructor(kind:string,input:unknown,page?:Pick<App,'levelScope'|'equipment'|'events'>){
    this.page=page;
    this.rows=structuredClone(parseActorProjectionV2(input));
    const freeze=(value:unknown):void=>{
      if(typeof value!=='object'||value===null)return;
      for(const child of Object.values(value))freeze(child);
      Object.freeze(value);
    };
    freeze(this.rows);
    const operations=this.rows.step?.operations??[];
    for(const operation of operations)if(operation.kind==='state'&&operation.states.some(state=>!ANIMAL_STATES.some(value=>value===state)))throw new Error('Unknown actor projection state');
    this.binding={kind,...(this.rows.step===undefined?{}:{think:(actor,context)=>{
          this.step(actor,context);
        }}),...(this.rows.damage===undefined?{}:{damageMul:this.damage.bind(this)})};
  }
  /** Strike admission precedes publishing the shared programme, as at the
  * original native bind slot. The original ReturnProgram scope owns caching. */
  program(scope: Scope | undefined=this.page?.levelScope??undefined):ReturnProgram{
    for(const operation of this.rows.step?.operations??[])if(operation.kind==='contact'&&!this.strikes.has(operation)){
      const strike=strikeFromData(operation.strike);
      if(operation.length!==undefined&&strike.shape.kind!=='wedge')throw new Error('Scaled contact requires wedge');
      this.strikes.set(operation,strike);
    }
    if(scope===undefined)return ReturnProgram.page(this.rows.program);
    if(scope.disposed||scope.disposing)throw new Error('Actor projection owner disposed');
    if(this.programme?.scope!==scope){
      const value=ReturnProgram.page(this.rows.program,scope);this.programme={scope,value};
      scope.onDispose(()=>{if(this.programme?.scope===scope)this.programme=null;});
    }
    return this.programme.value;
  }
  /** Preparation executes no guest or contact admission; those remain at program(). */
  prepareMemory(scope: Scope): boolean { return ReturnProgram.prepareMemory(this.rows.program, scope); }
  private captureOwners<A extends AnimalSim>(actor:A,context:ActorProjectionContext<A>|undefined,hit?:Vector3,request?:DamageRequest,owner?:ActorProjectionOwner):V2ColumnOwners{
    const scope=owner?.scope??this.page?.levelScope;
    if(scope===undefined||scope===null||scope.disposed||scope.disposing)throw new Error('Actor projection owner disposed');
    if(this.scope!==scope){
      const columns=[...(this.rows.step===undefined?[]:[this.rows.step.columns]),...(this.rows.damage?.requests.map(row=>row.columns)??[])];
      this.columns=columns.map(row=>new ObservationColumnsV2(row,scope));
      this.scope=scope;
      scope.onDispose(()=>{
        if(this.scope===scope){
          this.columns=[];
          this.scope=null;
        }
      });
    }
    const equipment=context===undefined?this.page?.equipment:null;
    return {...owner,scope,self:{group:owner?.group??this.binding.kind,slot:owner?.slot??0,identity:owner?.identity??actor.entityId,actor},observed:owner?.observed??new Map(),
      player:{position:context?.player??actor.position},t:context?.t??0,dt:context?.dt??0,
      ...(context===undefined?{}:{context}),
      ...(hit===undefined?{}:{hit}),request:request??null,equipment:equipment!==undefined&&equipment!==null&&equipment.visible&&!equipment.stowed?equipment.current.row.id:''};
  }
  private observations(index:number,owners:V2ColumnOwners):Record<string,number>{
    const columns=this.columns[index];
    if(columns===undefined)throw new Error('Missing actor projection columns');
    return Object.fromEntries(columns.capture(owners).map(row=>[row.name,row.value]));
  }
  /** Sample and apply once at the original native callback slot. */
  step<A extends AnimalSim>(actor:A,context:ActorProjectionContext<A>,owner?:ActorProjectionOwner):void{
    const row=this.rows.step;
    if(row===undefined)return;
    const scope=owner?.scope??this.page?.levelScope;if(scope===undefined||scope===null||scope.disposed||scope.disposing)throw new Error('Actor projection owner disposed');
    // The original cadence guard precedes scope/column allocation and ALL live
    // sampling. Only this actor's declared columns are captured when due.
    const previous=actor.mem[row.clock],elapsed=previous===undefined?context.dt:context.t-previous;
    if(previous!==undefined&&elapsed<row.every-1e-9)return;
    const dt=row.dt==='context'?context.dt:elapsed,owners=this.captureOwners(actor,context,undefined,undefined,owner);
    const programme=this.program(owners.scope);if(programme.prepare===undefined)throw new Error('Missing actor projection preparation');
    const prepared=programme.prepare(row.signal,this.observations(0,{...owners,dt}),owner?.random),answer=prepared.values;
    const scalar=(value:Scalar):number=>number(value.kind==='constant'?value.value:value.kind==='channel'?answer[value.name]:value.kind==='time'?context.t:context.player[value.axis]);
    const condition=(when:{channel:string;
      equal:number}):boolean=>number(answer[when.channel])===when.equal;
    // Resolve every scalar/shape before publishing the first write. Operations
    // retain the same body reference even if an earlier native effect retires it.
    const memory=actor.mem,position=actor.position,look=actor.lookTarget,player=context.player;
    const pins:(()=>boolean)[]=[];
    const pin=(native:object,method:string):void=>{
      const value:unknown=Reflect.get(native,method);
      if(typeof value!=='function')throw new Error('Missing actor projection native port');
      pins.push(()=>Reflect.get(native,method)===value);
    };
    for(const operation of row.operations){
      if('when' in operation&&!condition(operation.when))continue;
      if(operation.kind==='attack')pin(actor,'startAttack');
      if(operation.kind==='cancel')pin(actor,'cancelAttack');
      if(operation.kind==='motion'){
        pin(actor,'setMotion');
        if(operation.path!==undefined&&condition(operation.path))pin(context,'steer');
      }
      if(operation.kind==='contact'){
        pin(context,'reach');
        pin(context,'hurt');
        pin(context,'sound');
      }
      if(operation.kind==='sound')pin(context,'sound');
      if(operation.kind==='navigate'){pin(actor,'setMotion');pin(context,'steer');pin(context,'pathYaw');}
      if(operation.kind==='confine')pin(context,'confine');
    }
    const live=():void=>{
      if(owners.scope.disposed||owners.scope.disposing)throw new Error('Actor projection owner disposed');
      if(actor.mem!==memory||actor.position!==position||actor.lookTarget!==look||context.player!==player||pins.some(valid=>!valid()))throw new Error('Replaced actor projection native owner');
    };
    const operations=row.operations.map(operation=>{
      const enabled=!('when' in operation)||condition(operation.when);
      switch(operation.kind){
        case 'memory': {
          const value=operation.optional===true&&operation.value.kind==='channel'&&answer[operation.value.name]===undefined?undefined:scalar(operation.value);
          return ()=>{
            if(value!==undefined)actor.mem[operation.key]=value;
          };
        }
        case 'position': {
          const value=scalar(operation.value);
          return ()=>{
            actor.position[operation.axis]=value;
          };
        }
        case 'look-position':{
          const x=scalar(operation.x),y=scalar(operation.y),z=scalar(operation.z),weight=scalar(operation.weight);
          return ()=>{actor.lookTarget.set(x,y,z);actor.lookWeight=weight;};
        }
        case 'navigate':{
          const x=scalar(operation.x),z=scalar(operation.z),yaw=scalar(operation.yaw),speed=scalar(operation.speed),turn=scalar(operation.turn),path=scalar(operation.path);
          const pathYaw=context.pathYaw;
          if(pathYaw===undefined)throw new Error('Missing actor projection navigation');
          return ()=>{const heading=path>0?pathYaw.call(context,actor,x,z,path):yaw;live();if(path<0)actor.setMotion(heading,speed,turn);else context.steer(actor,heading,speed,turn);};
        }
        case 'confine':{
          const confine=context.confine;if(confine===undefined)throw new Error('Missing actor projection confinement');
          return ()=>{confine.call(context,actor);};
        }
        case 'sound-position':{
          const emit=scalar(operation.value),events=this.page?.events;
          if(events===undefined)throw new Error('Missing actor projection sound owner');pin(events,'emit');
          return ()=>{if(emit!==0)events.emit('creature.sound',{cue:operation.cue,x:actor.position.x,y:terrainHeight(actor.position.x,actor.position.z)+operation.height,z:actor.position.z});};
        }
        case 'look': {
          const value=scalar(operation.weight);
          return ()=>{
            actor.lookTarget.copy(context.player);
            actor.lookWeight=value;
          };
        }
        case 'state': {
          const index=scalar(operation.value),state=ANIMAL_STATES.find(value=>value===operation.states[index]);
          if(operation.required===true&&state===undefined)throw new Error('Invalid actor projection state');
          return ()=>{
            if(state!==undefined)actor.state=state;
          };
        }
        case 'attack':return ()=>{
          if(enabled)actor.startAttack(operation.seconds);
        };
        case 'cancel':return ()=>{
          if(enabled)actor.cancelAttack();
        };
        case 'motion': {
          const yaw=scalar(operation.yaw),speed=scalar(operation.speed),turn=scalar(operation.turn),path=operation.path!==undefined&&condition(operation.path);
          return ()=>{
            if(enabled){
              if(path)context.steer(actor,yaw,speed,turn);
              else actor.setMotion(yaw,speed,turn);
            }
          };
        }
        case 'sound': {
          const sound=operation.sounds[scalar(operation.value)];
          return ()=>{
            if(sound!==undefined&&sound!=='')context.sound(sound);
          };
        }
        case 'contact': {
          const strike=this.strikes.get(operation);
          if(strike===undefined)throw new Error('Missing actor projection contact');
          const damage=scalar(operation.damage),length=operation.length;
          const scaledLength=length===undefined?undefined:number(length[0]*number(actor.scale)/length[1]+length[2]);
          if(scaledLength!==undefined&&scaledLength<0)throw new Error('Invalid scaled contact');
          const shape=scaledLength===undefined?strike.shape:{...strike.shape,length:scaledLength};
          return ()=>{
            if(enabled){
              this.contacts.contact({...strike,shape},{actor,target:context.player,canReach:()=>{
                  live();
                  const reachable=context.reach(actor);
                  live();
                  return reachable;
                },hit:()=>{
                  live();
                  context.hurt(damage);
                  live();
                }});
              if(operation.sound!==undefined){
                live();
                context.sound(operation.sound);
              }
            }
          };
        }
        default:throw new Error('Unknown actor projection operation');
      }
    });
    live();prepared.accept();
    for(const operation of operations){
      if(owners.scope.disposed||owners.scope.disposing)throw new Error('Actor projection owner disposed');
      if(actor.mem!==memory||actor.position!==position||actor.lookTarget!==look||context.player!==player||pins.some(valid=>!valid()))throw new Error('Replaced actor projection native owner');
      operation();
    }
  }
  private damage(actor:Animal,hit:Vector3,_direction:Vector3,request:DamageRequest|undefined):number{
    const row=this.rows.damage;
    if(row===undefined)throw new Error('Missing actor damage projection');
    const owners=this.captureOwners(actor,undefined,hit,request),program=this.program(),results:Record<string,number>={};
    for(const [index,query]of row.requests.entries())Object.assign(results,program.project(query.signal,this.observations(index+(this.rows.step===undefined?0:1),{...owners,results})));
    return number(results[row.result]);
  }
}
