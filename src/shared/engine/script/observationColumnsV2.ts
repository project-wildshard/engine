import { parseObservationColumnsV2,type ObservationColumnV2 } from '@wildshard/format/scriptObservationColumnsV2';
import type { Scope } from '../app/scope';
import type { AnimalSim } from '../entities/AnimalSim';
import type { GrazerBrain } from '../../../server/engine/ai/grazer';
import type { Vector3 } from 'three';
import type { DayCycleClock } from '../world/dayCycle';

/** Both page and native population environments lend these SAME live fields.
 * grassHeightAt is the installed field owner's query, not an authored callback. */
export interface V2EnvironmentColumns {
  readonly playerCrouched: boolean; readonly playerFwdX: number; readonly playerFwdZ: number;
  readonly playerMounted: boolean; readonly playerHealth01: number;
  readonly light: number; readonly storm: boolean;
  readonly wind: { readonly x: number; readonly z: number; readonly strength: number };
  readonly grassHeightAt: (x: number,z: number) => number;
}
/** Same native senses and player used by the original group decision slot.
 * Sampling observes only; no random stream, schedule or group is created. */
export interface V2SenseColumns {
  readonly player:Vector3;
  readonly visibility:(x:number,z:number,player:Vector3,speed:number,time:number)=>number;
  readonly hearing:(radii:readonly[number,number,number,number],player:Vector3,speed:number)=>number;
  readonly downwind:(x:number,z:number,player:Vector3)=>boolean;
}
/** An original scoped body/prey loan, including native crowd members that do
 * not have AnimalSim storage. Identity comes from the original roster owner. */
export interface V2ReferenceColumn {
  readonly identity: string;
  readonly handle: number;
  readonly body: {
    readonly position: Readonly<{x:number;y:number;z:number}>;
    readonly yaw: number;
    readonly alive: boolean;
  };
}
export interface V2ActorColumnSlot<A extends AnimalSim = AnimalSim> {
  readonly group: string; readonly slot: number; readonly identity: string;
  readonly actor: A | null;
}
export interface V2CrowdColumns {
  readonly cx:number;readonly cz:number;
  readonly straggler:(distance:number)=>number;
  readonly positions:(index:number,out:Vector3)=>void;
}
export interface V2RosterColumn {readonly alive:boolean;readonly position:Readonly<{x:number;y:number;z:number}>}
type Herd = Pick<GrazerBrain<AnimalSim>,'cx' | 'cz' | 'trust' | 'alert' | 'stallionState' | 'mode' | 'stallion'>;
/** These are concrete borrowed owners, resolved by the existing actor authority
 * before capture. This resolver never allocates, adopts or indexes a body. */
export interface V2ColumnOwners<A extends AnimalSim = AnimalSim> {
  readonly scope: Scope; readonly self: V2ActorColumnSlot<A>;
  readonly player: { readonly position: Readonly<{ x: number; y?: number; z: number }> };
  readonly observed: ReadonlyMap<number,AnimalSim>;
  readonly crowd?:{readonly owner:V2CrowdColumns;readonly point:Vector3};
  readonly rosters?:ReadonlyMap<string,readonly V2RosterColumn[]>;
  readonly references?: ReadonlyMap<string,V2ReferenceColumn | null>;
  readonly t: number; readonly dt: number;
  readonly context?: {readonly calm:boolean;readonly playerSpeed:number};
  readonly hit?: Readonly<{x:number;y:number;z:number}>;
  readonly request?: {readonly sourceTags:readonly string[]} | null;
  readonly equipment?: string;
  readonly results?: Readonly<Record<string,number>>;
  readonly environment?: V2EnvironmentColumns;
  readonly senses?: V2SenseColumns;
  readonly clock?: Pick<DayCycleClock,'hour' | 'dayPhase' | 'night'>;
  readonly weather?: { readonly stormActive: boolean };
  readonly herds?: readonly { readonly group: string; readonly slot: number; readonly owner: Herd | null }[];
  readonly taming?: { readonly phase: string; readonly companion: AnimalSim | null } | null;
  readonly mount?: { readonly mounted: boolean; readonly actor: AnimalSim | null } | null;
}
function freeze(value: unknown):void {
  if(typeof value!=='object'||value===null||Object.isFrozen(value))return;
  for(const child of Object.values(value))freeze(child);
  Object.freeze(value);
}
function finite(value: number): number { if (!Number.isFinite(value)) throw new Error('Non-finite observation column');return value; }
function need<T>(value: T | undefined,kind: string): T { if (value === undefined) throw new Error(`Missing observation ${kind} owner`);return value; }

type Immutable<T> = T extends object ? { readonly [Key in keyof T]: Immutable<T[Key]> } : T;
/** One admitted column's source, as a caller reads it. */
export type V2ColumnSource = Immutable<ObservationColumnV2['source']>;
interface NumericReferencePin {
  readonly name: string;
  loan: V2ReferenceColumn | null | undefined;
  body: V2ReferenceColumn['body'] | undefined;
  identity: string | undefined;
  handle: number | undefined;
}

/** Compile common scalar and point readers once. Queries retain their native
 * receiver and per-capture fences; every reader samples the current owner. */
function scalarReader(source: Immutable<ObservationColumnV2['source']>): ((owners: V2ColumnOwners) => number) | undefined {
  switch (source.kind) {
    case 'memory': return owners => {
      const body=need(owners.self.actor??undefined,'self'), fallback=source.default;
      let value=body.mem[source.key]??(fallback.when!==undefined&&body.mem[fallback.when.field]===fallback.when.equal?fallback.when.value:
        fallback.source===undefined?fallback.value:fallback.source==='yaw'?body.yaw:body.position[fallback.source]);
      if(source.encoding!==undefined){
        if(value!==-Infinity&&!Number.isFinite(value))throw new Error('Invalid encoded memory value');
        value=source.encoding.part==='valid'?Number(value!==-Infinity):value===-Infinity?0:value;
      }
      return value;
    };
    case 'memory-present': return owners=>Number(source.keys.every(key=>owners.self.actor?.mem[key]!==undefined));
    case 'actor-state': return owners=>source.states.indexOf(need(owners.self.actor??undefined,'self').state);
    case 'result': return owners=>need(owners.results?.[source.channel],'projection result');
    case 'reference': return owners=>{
      const loan=need(need(owners.references,'reference').get(source.binding),'reference binding');
      if(loan===null)return 0;
      if(source.field==='present')return 1;
      if(source.field==='handle')return loan.handle;
      if(source.field==='x'||source.field==='y'||source.field==='z')return loan.body.position[source.field];
      return Number(loan.body[source.field]);
    };
    case 'actor': return owners=>{
      const actor=owners.self.actor, field=source.field;
      if(actor===null)return field==='attackPhase'?-1:0;
      if(field==='lastHitValid'||field==='lastHitSeconds'){
        const stamp=actor.lastHitT;
        if(stamp!==-Infinity&&!Number.isFinite(stamp))throw new Error('Invalid actor hit stamp');
        return field==='lastHitValid'?Number(stamp!==-Infinity):stamp===-Infinity?0:stamp;
      }
      if(field==='modSpeed')return actor.mods.speed;
      if(field==='x'||field==='y'||field==='z')return actor.position[field];
      if(field==='hpShare'){if(actor.maxHp<=0)throw new Error('Invalid actor maximum health');return actor.hp/actor.maxHp;}
      return Number(actor[field]);
    };
    case 'player': return owners=>{
      const env=need(owners.environment,'environment');
      switch(source.field){case 'crouched':return Number(env.playerCrouched);case 'forwardX':return env.playerFwdX;case 'forwardZ':return env.playerFwdZ;
        case 'mounted':return Number(env.playerMounted);case 'healthShare':return env.playerHealth01;default:throw new Error('Unknown player column');}
    };
    case 'environment': return owners=>Number(need(owners.environment,'environment')[source.field]);
    case 'wind':return owners=>need(owners.environment,'environment').wind[source.field];
    case 'grass':return owners=>{
      const point=source.at==='self'?owners.self.actor?.position:owners.player.position;
      return point===undefined?0:need(owners.environment,'environment').grassHeightAt(finite(point.x),finite(point.z));
    };
    case 'time': return owners=>{const value=owners[source.field];if(source.field==='dt'&&value<0)throw new Error('Negative observation dt');return value;};
    case 'player-position': return owners=>need(owners.player.position[source.axis],'player position');
    case 'context': return owners=>Number(need(owners.context,'context')[source.field]);
    case 'bearing': case 'clock': case 'crowd': case 'distance-xz': case 'equipment':
    case 'heading-component': case 'heading-offset': case 'herd': case 'herd-state': case 'hit': case 'mount': case 'nearest':
    case 'request': case 'request-tags': case 'sense': case 'taming': case 'weather': return undefined;
    default: throw new Error('Unknown observation source');
  }
}

/** Detached columns at the original decision slot. No scheduler, body/RNG/save
 * owner or cached world frame lives here. In particular, keeper grass at:self
 * is sampled at the ACTOR, while an absent actor retains the original zero. */
export class ObservationColumnsV2 {
  private readonly rows: readonly Immutable<ObservationColumnV2>[];
  private readonly scope: Scope;
  private readonly scalars: readonly ((owners: V2ColumnOwners) => number)[] | undefined;
  private readonly referenceNames: readonly string[];
  private numericPins: NumericReferencePin[] | undefined;
  private readonly environmentColumns: readonly { readonly index: number; readonly grass?: 'self' | 'player' }[];
  constructor(input: unknown,scope: Scope) {
    this.scope = scope;
    const rows = parseObservationColumnsV2(input);
    freeze(rows);
    this.rows = Object.freeze(rows);
    const readers=this.rows.map(row=>scalarReader(row.source));
    this.scalars=readers.every(reader=>reader!==undefined)?readers:undefined;
    this.environmentColumns=this.rows.flatMap((row,index)=>{
      const source=row.source;
      return source.kind==='grass'?[{index,grass:source.at}]:source.kind==='player'||source.kind==='environment'||source.kind==='wind'?[{index}]:[];
    });
    this.referenceNames=[...new Set(this.rows.flatMap(row=>row.source.kind==='reference'?[row.source.binding]:[]))];
  }
  /** The same immutable admitted metadata, without sampling any live owner.
   * Reading declarations does not capture a frame or grant a live owner loan. */
  get declaredColumns(): readonly Immutable<ObservationColumnV2>[] { return this.rows; }
  /** Detached numeric columns in declaration order. Scalar readers are
   * compiled once; no per-column records, selector walk or sorting on a group
   * segment. Query-bearing declarations retain the full ordered capture path.
   * An optional caller-owned destination is overwritten in place. Its caller
   * must keep it exclusive through capture and synchronous consumption; omit
   * it for a detached result that can be retained across later captures. */
  captureNumeric(owners: V2ColumnOwners, selected?:readonly boolean[], destination?:Float64Array): Float64Array {
    if(selected!==undefined&&selected.length!==this.rows.length)throw new Error('Invalid observation selection');
    if(destination!==undefined&&destination.length!==this.rows.length)throw new Error('Invalid observation destination');
    if(this.scalars===undefined){
      if(selected!==undefined)throw new Error('Selected capture requires scalar columns');
      const captured=this.capture(owners);
      if(destination===undefined)return Float64Array.from(captured,row=>row.value);
      for(let index=0;index<captured.length;index++){
        const row=captured[index];if(row===undefined)throw new Error('Missing observation column');destination[index]=row.value;
      }
      return destination;
    }
    const self=owners.self,actor=self.actor;
    const environment=owners.environment,grass=environment?.grassHeightAt,queries:{at:'self'|'player';point:Readonly<{x:number;z:number}>|undefined}[]=[];
    for(const row of this.environmentColumns)if(selected?.[row.index]!==false){
      need(environment,'environment');
      if(row.grass!==undefined)queries.push({at:row.grass,point:row.grass==='self'?actor?.position:owners.player.position});
    }
    const live=():void=>{
      if(owners.scope!==this.scope||this.scope.disposed||this.scope.disposing||owners.self!==self||self.actor!==actor
        ||actor!==null&&actor.entityId!==self.identity)throw new Error('Retired observation owner');
      if(queries.length>0&&(owners.environment!==environment||environment?.grassHeightAt!==grass
        ||queries.some(query=>(query.at==='self'?actor?.position:owners.player.position)!==query.point)))throw new Error('Replaced observation grass owner');
    };
    live();
    if(owners.observed.size>256||self.group.length===0||!Number.isInteger(self.slot)||self.slot<0
      ||actor===null&&self.identity!=='')throw new Error('Stale observation actor slot');
    let observed:Set<AnimalSim>|undefined;
    for(const[handle,body]of owners.observed){
      observed??=new Set<AnimalSim>();
      if(!Number.isInteger(handle)||handle<1||handle>0x7fffffff||observed.has(body)||body.entityId.length===0)throw new Error('Invalid observed actor identity');
      observed.add(body);
    }
    const owner=owners.references;
    if((owner?.size??0)>128)throw new Error('Observation reference capacity');
    // One inactive pin bank, never shared with a nested capture. All borrowed
    // references are cleared even when a query or a final fence refuses.
    const refs=this.numericPins??this.referenceNames.map(name=>({name,loan:undefined,body:undefined,identity:undefined,handle:undefined}));
    this.numericPins=undefined;
    try {
    for(let index=0;index<refs.length;index++){
      const pin=refs[index];if(pin===undefined)throw new Error('Missing observation reference pin');
      const loan=need(need(owner,'reference').get(pin.name),'reference binding');
      if(loan!==null&&(loan.identity.length===0||!Number.isInteger(loan.handle)||loan.handle<1||loan.handle>0x7fffffff
        ||typeof loan.body.alive!=='boolean'))throw new Error('Invalid observation reference loan');
      pin.loan=loan;pin.body=loan?.body;pin.identity=loan?.identity;pin.handle=loan?.handle;
    }
    const values=destination??new Float64Array(this.scalars.length);
    if(selected!==undefined)values.fill(Number.NaN);
    let index=0;
    // A read only reaches foreign code through a grass query, so only those fence each column; the fence below covers the rest.
    const fence=queries.length>0;
    for(const read of this.scalars){
      const column=index++;if(selected?.[column]===false)continue;
      if(fence)live();
      values[column]=finite(read(owners));
    }
    live();
    if(owners.references!==owner)throw new Error('Retired observation owner');
    for(let pinIndex=0;pinIndex<refs.length;pinIndex++){
      const pin=refs[pinIndex];if(pin===undefined)throw new Error('Missing observation reference pin');
      const loan=owner?.get(pin.name);
      if(loan!==pin.loan||loan?.body!==pin.body||loan?.identity!==pin.identity||loan?.handle!==pin.handle)throw new Error('Retired observation owner');
    }
    return values;
    } finally {
      for(let index=0;index<refs.length;index++){
        const pin=refs[index];if(pin!==undefined){pin.loan=undefined;pin.body=undefined;pin.identity=undefined;pin.handle=undefined;}
      }
      this.numericPins=refs;
    }
  }
  capture(owners: V2ColumnOwners): readonly { readonly name: string; readonly id: number; readonly value: number }[] {
    if (owners.scope !== this.scope || this.scope.disposed || this.scope.disposing) throw new Error('Retired observation owner');
    const self = owners.self, actor = self.actor;
    if (owners.observed.size > 256 || self.group.length === 0 || !Number.isInteger(self.slot) || self.slot < 0 || (actor !== null && actor.entityId !== self.identity)
      || (actor === null && self.identity !== '')) throw new Error('Stale observation actor slot');
    const observed = new Map<AnimalSim,number>();
    for (const [handle,body] of owners.observed) {
      if (!Number.isInteger(handle) || handle < 1 || handle > 0x7fffffff || observed.has(body) || body.entityId.length === 0) throw new Error('Invalid observed actor identity');
      observed.set(body,handle);
    }
    const identity = (body: AnimalSim | null): number => body === null ? 0 : need(observed.get(body),'actor identity');
    const herds = owners.herds ?? [];
    if (herds.length > 64 || new Set(herds.map(row => JSON.stringify([row.group,row.slot]))).size !== herds.length) throw new Error('Ambiguous observation herd loan');
    const referencePins: (() => boolean)[] = [];
    const crowds=new Map<number,number>(),nearest=new Map<string,{body:V2RosterColumn|null;distance:number}>();
    const crowd=owners.crowd;
    const crowdPins=crowd===undefined?undefined:{straggler:crowd.owner.straggler,positions:crowd.owner.positions};
    const sensePins:{owner:V2SenseColumns;field:'visibility'|'hearing'|'downwind';callable:unknown;player:Vector3}[]=[];
    // Resolve the complete suffix before invoking any native grass query.
    const prepared = this.rows.map(row => {
      const source = row.source;
      if(source.kind==='crowd'||source.kind==='nearest')need(crowd,'crowd');
      if(source.kind==='nearest')need(owners.rosters?.get(source.roster),'roster');
      if (source.kind === 'environment' || source.kind === 'grass' || source.kind === 'player' || source.kind === 'wind') need(owners.environment,'environment');
      if(source.kind==='sense'){
        const owner=need(owners.senses,'senses');need(owners.context,'sense context');
        const callable:unknown=Reflect.get(owner,source.field);
        if(typeof callable!=='function'||owner.player!==owners.player.position)throw new Error('Invalid native sense owner');
        sensePins.push({owner,field:source.field,callable,player:owner.player});
      }
      let reference: V2ReferenceColumn | null = null;
      if (source.kind === 'reference') {
        const owner = need(owners.references,'reference'), loan = need(owner.get(source.binding),'reference binding');
        if (owner.size > 128) throw new Error('Observation reference capacity');
        if (loan !== null && (loan.identity.length === 0 || !Number.isInteger(loan.handle) || loan.handle < 1 || loan.handle > 0x7fffffff
          || typeof loan.body.alive !== 'boolean')) throw new Error('Invalid observation reference loan');
        reference = loan;
        const body = loan?.body, referenceIdentity = loan?.identity, handle = loan?.handle;
        referencePins.push(() => owners.references === owner && owner.get(source.binding) === loan
          && loan?.body === body && loan?.identity === referenceIdentity && loan?.handle === handle);
      }
      if (source.kind === 'clock') need(owners.clock,'clock');
      if (source.kind === 'weather') need(owners.weather,'weather');
      if (source.kind === 'taming') need(owners.taming,'taming');
      if (source.kind === 'mount') need(owners.mount,'mount');
      const herd = source.kind === 'herd' || source.kind === 'herd-state'
        ? need(herds.find(value => value.group === source.group && value.slot === source.slot),'herd').owner : null;
      if (source.kind === 'herd' && source.field === 'stallion' && herd !== null) identity(herd.stallion);
      if (source.kind === 'taming' && source.field === 'companion') identity(owners.taming?.companion ?? null);
      if (source.kind === 'mount' && source.field === 'actor') identity(owners.mount?.actor ?? null);
      return { row,herd,reference };
    });
    const memory=():Readonly<Record<string,number>>|undefined=>actor?.mem;
    const point=(source: Extract<ObservationColumnV2['source'],{kind:'distance-xz'}>['from']):Readonly<{x:number;z:number}>=>{
      switch(source.kind){
        case 'self':return need(actor?.position,'self');
        case 'player':return owners.player.position;
        case 'hit':return need(owners.hit,'hit');
        case 'memory':return {x:memory()?.[source.x]??(source.fallback==='self'?need(actor?.position,'self').x:0),
          z:memory()?.[source.z]??(source.fallback==='self'?need(actor?.position,'self').z:0)};
        default:throw new Error('Unknown observation point');
      }
    };
    const live=():void=>{
      if(this.scope.disposed||this.scope.disposing||owners.self.actor!==actor||referencePins.some(pin=>!pin()))throw new Error('Retired observation owner');
      if(crowd!==undefined&&(owners.crowd!==crowd||crowd.owner.straggler!==crowdPins?.straggler||crowd.owner.positions!==crowdPins.positions))throw new Error('Replaced observation crowd owner');
      for(const pin of sensePins)if(owners.senses!==pin.owner||pin.owner.player!==pin.player
        ||owners.player.position!==pin.player||Reflect.get(pin.owner,pin.field)!==pin.callable)throw new Error('Replaced native sense owner');
    };
    const result=prepared.map(({ row,herd,reference }) => {
      live();
      const source = row.source;let value: number;
      switch (source.kind) {
        case 'crowd': {
          const loan=need(crowd,'crowd');
          if(source.field==='cx'||source.field==='cz')value=loan.owner[source.field];
          else {
            let index=crowds.get(source.distance);
            if(index===undefined){index=loan.owner.straggler(source.distance);live();if(index>=0)loan.owner.positions(index,loan.point);live();crowds.set(source.distance,index);}
            value=source.field==='present'?Number(index>=0):loan.point[source.field];
          }
          break;
        }
        case 'nearest': {
          let selected=nearest.get(source.roster);
          if(selected===undefined){
            const origin=need(crowd,'crowd').owner,roster=need(owners.rosters?.get(source.roster),'roster');
            let body:V2RosterColumn|null=null,distance=Infinity;
            for(const candidate of roster){const d=Math.hypot(candidate.position.x-origin.cx,candidate.position.z-origin.cz);if(candidate.alive&&d<distance){body=candidate;distance=d;}}
            selected={body,distance:body===null?0:distance};nearest.set(source.roster,selected);
          }
          value=source.field==='present'?Number(selected.body!==null):source.field==='distance'?selected.distance:selected.body?.position[source.field]??0;break;
        }
        case 'memory': {
          const fallback=source.default,body=need(actor??undefined,'self');
          value=body.mem[source.key]??(fallback.when!==undefined&&body.mem[fallback.when.field]===fallback.when.equal?fallback.when.value:
            fallback.source===undefined?fallback.value:fallback.source==='yaw'?body.yaw:body.position[fallback.source]);
          if (source.encoding !== undefined) {
            if (value !== -Infinity && !Number.isFinite(value)) throw new Error('Invalid encoded memory value');
            value = source.encoding.part === 'valid' ? Number(value !== -Infinity) : value === -Infinity ? 0 : value;
          }
          break;
        }
        case 'memory-present':value=Number(source.keys.every(key=>memory()?.[key]!==undefined));break;
        case 'actor-state':value=source.states.indexOf(need(actor??undefined,'self').state);break;
        case 'player-position':value=need(owners.player.position[source.axis],'player position');break;
        case 'context':value=Number(need(owners.context,'context')[source.field]);break;
        case 'hit':value=need(owners.hit,'hit')[source.axis];break;
        case 'request':value=Number(need(owners.request,'request')!==null);break;
        case 'request-tags':value=Number(need(owners.request,'request')?.sourceTags.some(tag=>source.tags.includes(tag))===true);break;
        case 'equipment':value=Number(source.ids.includes(need(owners.equipment,'equipment')));break;
        case 'result':value=need(owners.results?.[source.channel],'projection result');break;
        case 'reference':
          if (reference === null) value = 0;
          else if (source.field === 'present') value = 1;
          else if (source.field === 'handle') value = reference.handle;
          else if (source.field === 'x' || source.field === 'y' || source.field === 'z') value = reference.body.position[source.field];
          else value = Number(reference.body[source.field]);
          break;
        case 'bearing': {const target=point(source.target),body=need(actor??undefined,'self');value=Math.atan2(target.x-body.position.x,target.z-body.position.z);break;}
        case 'heading-offset': {
          const body=need(actor??undefined,'self'),heading=source.target.kind==='player'?Math.atan2(owners.player.position.x-body.position.x,owners.player.position.z-body.position.z):body.mem[source.target.key]??body.yaw;
          const delta=heading-body.yaw;value=Math.atan2(Math.sin(delta),Math.cos(delta));break;
        }
        case 'distance-xz': {const from=point(source.from),to=point(source.to);value=Math.hypot(from.x-to.x,from.z-to.z);break;}
        case 'heading-component':value=Math[source.axis](need(actor??undefined,'self').yaw*source.sign);break;
        case 'sense':{
          const sense=need(owners.senses,'senses'),context=need(owners.context,'sense context');
          if(actor===null){value=0;break;}
          const speed=finite(context.playerSpeed),time=finite(owners.t),x=finite(actor.position.x),z=finite(actor.position.z);
          value=source.field==='visibility'?sense.visibility(x,z,sense.player,speed,time)
            :source.field==='hearing'?sense.hearing(source.radii,sense.player,speed):Number(sense.downwind(x,z,sense.player));
          break;
        }
        case 'environment': value = Number(need(owners.environment,'environment')[source.field]);break;
        case 'wind': value = need(owners.environment,'environment').wind[source.field];break;
        case 'player': {
          const env = need(owners.environment,'environment');
          const fields = { crouched: Number(env.playerCrouched),forwardX: env.playerFwdX,forwardZ: env.playerFwdZ,mounted: Number(env.playerMounted),healthShare: env.playerHealth01 };
          value = fields[source.field];break;
        }
        case 'grass': {
          const sampledPoint = source.at === 'self' ? actor?.position : owners.player.position;
          value = sampledPoint === undefined ? 0 : need(owners.environment,'environment').grassHeightAt(finite(sampledPoint.x),finite(sampledPoint.z));break;
        }
        case 'clock': {
          const clock = need(owners.clock,'clock');
          value = source.field === 'dayPhase' ? clock.dayPhase === 'night' ? 2 : clock.dayPhase === 'dusk' ? 1 : 0 : clock[source.field];
          if (source.field === 'hour' && (value < 0 || value >= 24)) throw new Error('Observation hour outside day');break;
        }
        case 'time': value = owners[source.field];if (source.field === 'dt' && value < 0) throw new Error('Negative observation dt');break;
        case 'weather': value = Number(need(owners.weather,'weather').stormActive);break;
        case 'actor': {
          const field = source.field;
          if (actor === null) { value = field === 'attackPhase' ? -1 : 0;break; }
          if (field === 'lastHitValid' || field === 'lastHitSeconds') {
            const stamp = actor.lastHitT;
            if (stamp !== -Infinity && !Number.isFinite(stamp)) throw new Error('Invalid actor hit stamp');
            value = field === 'lastHitValid' ? Number(stamp !== -Infinity) : stamp === -Infinity ? 0 : stamp;
          } else if(field==='modSpeed')value=actor.mods.speed;
          else if (field === 'x' || field === 'y' || field === 'z') value = actor.position[field];
          else if (field === 'hpShare') { if (actor.maxHp <= 0) throw new Error('Invalid actor maximum health');value = actor.hp/actor.maxHp; }
          else value = Number(actor[field]);break;
        }
        case 'herd': {
          const field = source.field;
          value = herd === null ? 0 : field === 'beaten' ? Number(herd.stallionState === 'beaten')
            : field === 'fleeing' ? Number(herd.mode === 'flee') : field === 'sameActor' ? Number(actor !== null && herd.stallion === actor)
            : field === 'stallion' ? identity(herd.stallion) : herd[field];break;
        }
        case 'herd-state': value = herd === null ? 0 : source.states.find(code => code.state === herd.stallionState)?.value ?? 0;break;
        case 'taming': value = source.field === 'bonded' ? Number(owners.taming?.phase === 'bonded') : identity(owners.taming?.companion ?? null);break;
        case 'mount': value = source.field === 'mounted' ? Number(owners.mount?.mounted === true) : identity(owners.mount?.actor ?? null);break;
        default: throw new Error('Unknown observation source');
      }
      return { name: row.name,id: row.id,value: finite(value) };
    });
    live();return result;
  }
}
