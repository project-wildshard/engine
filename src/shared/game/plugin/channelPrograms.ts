import * as poseSchema from 'valibot';
import type { Euler } from 'three';
import { NumericPoseSchema, type NumericPoseInputSchema, parseClientChannels, type ClientChannelProgram } from '@wildshard/format/clientChannels';
import type { AnimalRigContext, AnimalRigJoint } from '@wildshard/engine/entities/animalRig';
import { lookAngles, squashBody } from '@wildshard/engine/entities/species/rigs';
import {admittedClientChannels,bindClientChannelInputRows,planMergedChannels,publishMergedChannels,type MergedChannelPlan} from './channels';
import { parsePackedCreatureLooks } from '@wildshard/format/speciesLooks';
import { emitFault, NumericInputError } from '@wildshard/engine/core/faults';

/** Copied values may be an existing common read vector or a named observation for independently authored DAGs. */
export interface ChannelProgramObservation {readonly time:number;readonly delta:number;readonly values:readonly number[]|Readonly<Record<string,number>>}
function vector(value:ChannelProgramObservation['values']):value is readonly number[]{return Array.isArray(value);}
const notedPoses = new WeakSet();
/** Every `mem` field a pose program built on this page reads. A body a server runs writes these there, and only this page knows which they are. */
export const poseInputNames: Set<string> = new Set<string>();
function notePoseInputs(row: unknown): void {
  if (typeof row !== 'object' || row === null || notedPoses.has(row)) return;
  notedPoses.add(row);
  if ('path' in row && Array.isArray(row.path) && row.path[0] === 'mem' && typeof row.path[1] === 'string') poseInputNames.add(row.path[1]);
  for (const value of Object.values(row)) notePoseInputs(value);
}
/** Pose memory is a numeric record, never an accessor on an authored owner. */
function poseMemory(memory: Readonly<Record<string, number>>, name: string): number | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(memory, name);
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw new Error('Creature pose memory must be a numeric record');
  const value: unknown = descriptor.value;
  if (typeof value !== 'number') throw new Error('Creature pose memory must be numeric');
  return value;
}
/** G639: one admission per channel table: a page installs one table group by group (Nalati's sky, weather, figures, its
 *  crowd), and each install parsed the whole table again (0.3-0.65 s frames in its grid entry). The admitted rows are
 *  frozen, so every lane reads them in place (admittedClientChannels copies only rows it does not know are fixed). */
const tables=new WeakMap<object,readonly ClientChannelProgram[]>();
const freeze=<T,>(value:T):T=>{if(typeof value==='object'&&value!==null&&!Object.isFrozen(value)){for(const field of Object.values(value))freeze(field);Object.freeze(value);}return value;};
export function admittedChannelTable(input:unknown):readonly ClientChannelProgram[]{
 if(typeof input!=='object'||input===null)return parseClientChannels(input);
 let rows=tables.get(input);if(rows===undefined){rows=freeze(parseClientChannels(input));tables.set(input,rows);}
 return rows;
}
/** One bounded group of the existing visual DAG owner; supplied owners expose only explicitly declared numeric fields.
 * Runtime numeric refusals skip the group and report once; malformed declarations still fail admission. */
export function installChannelPrograms(input:unknown,group:string,owners:ReadonlyMap<string,unknown>):{
 evaluate:(observation:ChannelProgramObservation)=>void;capture:()=>()=>void;readonly ids:readonly string[]
}{return buildChannelPrograms(input,group,owners);}
/** A merged plan per admitted table, group and copied read order (the same for every rig over that table). */
const plans=new WeakMap<object,Map<string,MergedChannelPlan|null>>();
function mergedPlan(input:unknown,group:string,selected:readonly ClientChannelProgram[],names:readonly string[]):MergedChannelPlan|null{
 if(typeof input!=='object'||input===null)return planMergedChannels(selected,names);
 let byGroup=plans.get(input);if(byGroup===undefined){byGroup=new Map();plans.set(input,byGroup);}
 const key=`${group}\0${names.join('\0')}`;
 if(!byGroup.has(key))byGroup.set(key,planMergedChannels(selected,names));
 return byGroup.get(key)??null;
}
// Only this module's detached pose observations use prebound vector indices.
function buildChannelPrograms(input:unknown,group:string,owners:ReadonlyMap<string,unknown>,copiedNames?:readonly string[]):ReturnType<typeof installChannelPrograms>{
 const selected=admittedChannelTable(input).filter(row=>row.numeric?.group===group);
 if(selected.length===0)throw new Error(`Missing numeric channel group: ${group}`);
 // FC CPU cut: lanes of a group reading one owner field share one read a call (Nine's frame group: 544 reads of 138 fields),
 // taken lazily at its first use so reads (and a refusal) happen in the same order as one read per lane
 const shared:(()=>number)[]=[],sharedAt=new Map<string,number>(),sharedValues:number[]=[],sharedCall:number[]=[];let call=0;
 const lanes=selected.map(row=>{
  const binding=row.numeric;if(binding===undefined)throw new Error('Missing numeric channel metadata');
  const lane=admittedClientChannels(row),inputs=bindClientChannelInputRows(binding.inputs,owners,new Set(lane.reads));
  const ports=lane.bindNumeric(binding.outputs,owners),restoreOnly=lane.bindNumeric(binding.restoreOnly.map(({property,target,path,nullable})=>({property,target,path,restore:true,nullable:nullable??false})),owners),values:number[]=Array.from({length:lane.reads.length},()=>0);
  // each read's shared bound input (-1: it comes from the observation), looked up once
  const readers=lane.reads.map(id=>{const bound=inputs.get(id);if(bound===undefined)return -1;
   let at=sharedAt.get(bound.key);if(at===undefined){at=shared.length;shared.push(bound.read);sharedAt.set(bound.key,at);sharedValues.push(0);sharedCall.push(-1);}return at;});
  const indices=copiedNames===undefined?undefined:lane.reads.map(name=>copiedNames.indexOf(name));
  if(indices?.some(index=>index<0)||copiedNames!==undefined&&inputs.size>0)throw new Error('Invalid copied pose reads');
  return {lane,inputs,readers,ports,restoreOnly,values,indices,observation:{time:0,delta:0,values}};
 });
 const ids=Object.freeze(selected.map(row=>row.id));
 // A fully borrowed group snapshots its canonical inputs in first-use order,
 // then fans each scalar into the lanes' existing private observation arrays.
 const borrowed=copiedNames===undefined&&lanes.every(row=>row.readers.every(read=>read>=0));
 const gathers:{read:()=>number;writes:{values:number[];slot:number}[]}[]=borrowed?shared.map(read=>({read,writes:[]})):[];
 if(borrowed)for(const {readers,values}of lanes)for(const [slot,index]of readers.entries()){
  const gather=gathers[index];if(gather===undefined)throw new Error('Missing bound channel input');gather.writes.push({values,slot});
 }
 // DW story margin: a rig's pose programs share most expressions (Driftwood's rows: 68 % of their dynamic nodes), so a
 // copied pose evaluates them once as one merged lane and publishes each lane's channels; a refused merged frame runs the
 // lanes themselves, which refuse exactly as before
 const merge=copiedNames===undefined?null:mergedPlan(input,group,selected,copiedNames);
 const merged=merge===null?null:admittedClientChannels(merge.program),laneList=lanes.map(row=>row.lane);
 let reported=false;
 return Object.freeze({ids,
  evaluate:(observation:ChannelProgramObservation):void=>{
   try {
   const external=observation.values,isVector=vector(external);call++;
   // Snapshot every borrowed read before any field is published, including cross-program dependencies.
   if(copiedNames!==undefined){
    if(!isVector||external.length!==copiedNames.length)throw new Error('Invalid copied pose vector');
    for(let index=0;index<external.length;index++){const value=external[index];if(value===undefined||!Number.isFinite(value)||Math.abs(value)>1e12)throw new NumericInputError(copiedNames[index]??String(index),'Invalid copied pose value');}
    let published=false;
    if(merge!==null&&merged!==null&&isVector){try{merged.evaluate({time:observation.time,delta:observation.delta,values:external});publishMergedChannels(merge,merged,laneList);published=true;}catch{/* the lanes below refuse as before */}}
    if(published){for(const {lane,ports} of lanes)ports.apply(lane.frame);return;}
    for(const {indices,values}of lanes){if(indices===undefined)throw new Error('Missing copied pose indices');for(let index=0;index<indices.length;index++)values[index]=external[indices[index]??-1]??Number.NaN;}
   }else if(borrowed){
    if(isVector&&(shared.length>0||external.length!==shared.length))throw new Error('Numeric channel vector differs from its declared reads');
    for(let index=0;index<gathers.length;index++){
     const gather=gathers[index];if(gather===undefined)throw new Error('Missing bound channel input');
     // The bound reader still validates this field and its cap every call.
     // A getter may synchronously evaluate this same group. Reuse the
     // nested call's completed read exactly as the original lane path does.
     const value=sharedCall[index]===call?(sharedValues[index]??Number.NaN):gather.read();
     sharedCall[index]=call;
     if(Object.is(value,sharedValues[index]))continue;
     sharedValues[index]=value;
     for(const {values,slot}of gather.writes)values[slot]=value;
    }
   }else for(const {lane,inputs,readers,values} of lanes){
    if(isVector&&(inputs.size>0||external.length!==values.length))throw new Error('Numeric channel vector differs from its declared reads');
    const reads=lane.reads;
    for(let index=0;index<reads.length;index++){
     const read=readers[index]??-1;let value:number|undefined;
     // a shared value this call already read passed the check below at its first read (a failing one ends the call)
     if(read>=0&&sharedCall[read]===call){values[index]=sharedValues[read]??Number.NaN;continue;}
     if(read<0){const id=reads[index]??'';value=isVector?external[index]:Object.hasOwn(external,id)?external[id]:undefined;}
     else{value=shared[read]?.();if(value!==undefined&&Number.isFinite(value)&&Math.abs(value)<=1e12){sharedValues[read]=value;sharedCall[read]=call;}}
     if(value===undefined||!Number.isFinite(value)||Math.abs(value)>1e12){const id=reads[index]??'';throw new NumericInputError(id,`Missing or invalid channel observation: ${id}`);}
     values[index]=value;
    }
   }
   // Existing evaluators publish only finite complete frames; no visual target changes on a refused input.
   for(const {lane,observation:frame} of lanes){frame.time=observation.time;frame.delta=observation.delta;lane.evaluate(frame);}
   for(const {lane,ports} of lanes)ports.apply(lane.frame);
   } catch(error) {
    // Detached pose lanes belong to their actor; the caller reports that actor.
    if(!(error instanceof NumericInputError)||copiedNames!==undefined)throw error;
    if(!reported){reported=true;emitFault({system:`channels.${group}`,error,verdict:'uncaught'});}
   }
  },
  capture:()=>{const restore=lanes.flatMap(row=>[row.ports.capture(),row.restoreOnly.capture()]);return()=>{for(const run of restore)run();};},
 });
}

/** A bone rotation's pending axes (see numericCreaturePose). */
interface Turn { readonly euler: Euler; x: number; y: number; z: number; dirty: boolean }
/** Numeric pose rows on existing joints. Each rig lends its frame and transforms to the existing channel evaluator;
 * optional bones are skipped, and no actor memory, clock, random stream or continuation is added.
 * A runtime numeric refusal preserves that actor's last pose, reports once and retries on its next frame. */
export function numericCreaturePose(poseData: unknown): (ctx: AnimalRigContext) => void {
  notePoseInputs(poseData);
  return compileNumericCreaturePose(poseSchema.parse(NumericPoseSchema, poseData));
}
/** The book parser already admits every nested pose. Only its immutable output
 * can take the shared path; unknown books still pass complete admission here. */
export function numericCreaturePoseFromBook(input: unknown, id: string): (ctx: AnimalRigContext) => void {
  const row = parsePackedCreatureLooks(input).poses[id];
  if (row === undefined) throw new Error('Missing packed creature joint pose');
  notePoseInputs(row);
  return compileNumericCreaturePose(row);
}
function compileNumericCreaturePose(row: poseSchema.InferOutput<typeof NumericPoseSchema>): (ctx: AnimalRigContext) => void {
  if (new Set(row.scalars.map(scalar => scalar.name)).size !== row.scalars.length
    || row.scalars.some(scalar => [scalar.name, ...scalar.path].some(key => ['constructor', 'prototype', '__proto__'].includes(key)))) throw new Error('Invalid creature pose scalar');
  if (row.programs.length === 0 || row.programs.some(program => {
    const binding = program.numeric;
    return binding.group !== row.group || binding.restoreOnly.length > 0
      || program.locals !== undefined || program.geometry !== undefined || program.connectors !== undefined
      || program.prompt !== undefined || program.bindings !== undefined || program.mover !== undefined
      || binding.outputs.some(output => !output.target.startsWith('joint.') || output.path.length !== 2
        || !['rotation', 'position', 'scale'].includes(output.path[0] ?? '') || !['x', 'y', 'z'].includes(output.path[1] ?? ''))
      || new Set(binding.outputs.map(output => output.target)).size !== 1;
  })) throw new Error('Invalid creature pose programme');
  // G639: one detached table per distinct set of programmes a rig carries, so the table is admitted once, not per rig (a
  // herd's first frame admitted it once for every body: most of a 350 ms Nalati cell-activation frame)
  // (with the programmes' merged inputs, which depend on the set alone)
  type PoseInput = poseSchema.InferOutput<typeof NumericPoseInputSchema>;
  const detachedTables = new Map<string, { readonly table: ReturnType<typeof parseClientChannels>; readonly inputs: readonly PoseInput[] }>();
  const detach = (programs: readonly (typeof row.programs)[number][]): { readonly table: ReturnType<typeof parseClientChannels>; readonly inputs: readonly PoseInput[] } => {
    const key = programs.map(program => row.programs.indexOf(program)).join(',');
    let detached = detachedTables.get(key);
    if (detached === undefined) {
      const inputs = new Map<string, PoseInput>();
      for (const program of programs) for (const input of program.numeric.inputs) {
        const prior = inputs.get(input.input);
        if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(input)) throw new Error('Ambiguous creature pose input');
        inputs.set(input.input, input);
      }
      // NumericPoseProgramsSchema already checked every DAG and aggregate cap.
      // Subsetting rows and removing their borrowed inputs preserves that proof;
      // keep this private frozen table instead of parsing the whole DAG again.
      const table = freeze(programs.map(program => ({ ...program, numeric: { ...program.numeric, inputs: [] } })));
      tables.set(table, table);
      detached = { table, inputs: [...inputs.values()] };
      detachedTables.set(key, detached);
    }
    return detached;
  };
  // a rig with every joint (the usual case) takes the whole table: admitted here, as the look loads, not in the frame a
  // herd first poses (G639: ~6 ms of a 200 ms Nalati cell-activation frame at phone 4x)
  admittedChannelTable(detach(row.programs).table);
  const rigs = new WeakMap<AnimalRigContext['bones'], {
    look: { yaw: number; pitch: number }; scalars: Record<string, number>;
    inputs: readonly poseSchema.InferOutput<typeof NumericPoseInputSchema>[]; joints: ReadonlyMap<string, AnimalRigJoint>;
    memory: Record<string, number | undefined>;
    observation: { time: number; delta: number; values: number[] };
    lane: ReturnType<typeof installChannelPrograms> | null; turns: readonly Turn[];
  }>();
  // Value-only scratch is lent to one synchronous invocation, including during getter reentry.
  // It retains no context, joint, actor or owner when the invocation returns or refuses.
  type FrameField = Extract<PoseInput, { kind: 'frame' }>['field'];
  const makeObservation = (): { scalarValues: Float64Array; dimensions: Record<string, number | undefined>; frame: Record<FrameField, number> } => ({
    scalarValues: new Float64Array(row.scalars.length), dimensions: {}, frame: { t: 0, dt: 0, seed: 0, scale: 0, speed: 0, strafe: 0,
      phase: 0, attack: 0, brace: 0, flinch: 0, deathT: 0, stateIndex: 0, yaw: 0, lookWeight: 0 },
  });
  const copyDimensions = (dimensions: Record<string, number | undefined>, c: AnimalRigContext): void => {
    dimensions['bodyY'] = c.dims.bodyY; dimensions['bodyHalfLen'] = c.dims.bodyHalfLen;
    dimensions['bodyRadius'] = c.dims.bodyRadius; dimensions['headRadius'] = c.dims.headRadius;
    dimensions['legLen'] = c.dims.legLen; dimensions['halfWidth'] = c.dims.halfWidth; dimensions['bodyPitch'] = c.dims.bodyPitch;
  };
  let available: ReturnType<typeof makeObservation> | undefined;
  const reported = new WeakSet<AnimalRigContext['animal']>();
  return c => {
    if ((row.alive !== undefined && row.alive !== c.alive)
      || (row.variant !== undefined && (!('variant' in c.animal) || c.animal.variant !== row.variant))) return;
    // Detached observations only: missing old-save memory can supply an authored default without a write.
    const observation = available ?? makeObservation(); available = undefined;
    try {
    const { scalarValues, dimensions, frame } = observation;
    for (let i = 0; i < row.scalars.length; i++) {
      const scalar = row.scalars[i]; if (scalar === undefined) throw new Error('Missing creature pose scalar');
      const key=scalar.path[0],field=scalar.path[1];
      copyDimensions(dimensions, c);
      let value:number|undefined;
      if(key==='mem'||key==='dims'){
        if(field===undefined)throw new Error('Missing creature pose field');
        value=key==='mem'?poseMemory(c.mem,field):!Object.hasOwn(dimensions,field)?undefined:dimensions[field];
      }else value=c[key];
      const number = value ?? scalar.fallback;
      if (typeof number !== 'number' || !Number.isFinite(number)) throw new NumericInputError(scalar.name, 'Invalid creature pose scalar observation');
      scalarValues[i] = number;
    }
    let rig = rigs.get(c.bones);
    if (rig === undefined) {
      const fields = (source: { x: number; y: number; z: number }) => ({
        get x() { return source.x; }, set x(value: number) { source.x = value; },
        get y() { return source.y; }, set y(value: number) { source.y = value; },
        get z() { return source.z; }, set z(value: number) { source.z = value; },
      });
      // a programme writes a rotation an axis at a time and every Euler write recomputes the bone's quaternion: the axes
      // gather here and land as one Euler.set a bone after the lane runs (G639: setFromEuler, ~0.14 ms a Nalati look frame)
      const turns: Turn[] = [], turned = (euler: Euler) => {
        const turn: Turn = { euler, x: 0, y: 0, z: 0, dirty: false }; turns.push(turn);
        const start = (): void => { if (!turn.dirty) { turn.x = euler.x; turn.y = euler.y; turn.z = euler.z; turn.dirty = true; } };
        return {
          get x() { return turn.dirty ? turn.x : euler.x; }, set x(value: number) { start(); turn.x = value; },
          get y() { return turn.dirty ? turn.y : euler.y; }, set y(value: number) { start(); turn.y = value; },
          get z() { return turn.dirty ? turn.z : euler.z; }, set z(value: number) { start(); turn.z = value; },
        };
      };
      const look = { yaw: 0, pitch: 0 }, owners = new Map<string, unknown>(Object.entries(c.bones).map(([name, bone]) => [
        `joint.${name.replaceAll('_', '.')}`, { position: fields(bone.position), rotation: turned(bone.rotation), scale: fields(bone.scale) },
      ]));
      const scalars: Record<string, number> = Object.fromEntries(row.scalars.map((scalar, i) => [scalar.name, scalarValues[i] ?? Number.NaN]));
      const joints = new Map(Object.entries(c.bones).map(([name, joint]) => [name.replaceAll('_', '.'), joint]));
      // Every program targets one optional bone; refuse mixed owners rather than silently dropping a partial program.
      const programs = row.programs.filter(program => {
        const targets = new Set(program.numeric.outputs.map(output => output.target));
        if (targets.size !== 1 || program.numeric.group !== row.group) throw new Error('Invalid creature pose target');
        return [...targets].every(target => owners.has(target));
      });
      const detached = detach(programs);
      rig = { look, scalars, joints, memory: {}, inputs: detached.inputs, observation: { time: c.t, delta: c.dt, values: Array.from({length:detached.inputs.length},()=>0) },
        lane: programs.length === 0 ? null : buildChannelPrograms(detached.table, row.group, owners,detached.inputs.map(input=>input.input)), turns };
      rigs.set(c.bones, rig);
    }
    for (let i = 0; i < row.scalars.length; i++) {
      const scalar = row.scalars[i]; if (scalar === undefined) throw new Error('Missing creature pose scalar');
      rig.scalars[scalar.name] = scalarValues[i] ?? Number.NaN;
    }
    if (row.look !== undefined) Object.assign(rig.look, lookAngles(c, ...row.look));
    frame.t = c.t; frame.dt = c.dt; frame.seed = c.seed; frame.scale = c.scale; frame.speed = c.speed; frame.strafe = c.strafe;
    frame.phase = c.phase; frame.attack = c.attack; frame.brace = c.brace; frame.flinch = c.flinch; frame.deathT = c.deathT;
    frame.stateIndex = row.states.indexOf(c.state); frame.yaw = c.yaw; frame.lookWeight = c.lookWeight;
    copyDimensions(dimensions, c);
    for(let index=0;index<rig.inputs.length;index++){
      const input=rig.inputs[index];if(input===undefined)throw new Error('Missing creature pose input');
      if(input.kind==='scalar'&&input.record==='memory')rig.memory[input.name]=poseMemory(c.mem,input.name);
    }
    for(let index=0;index<rig.inputs.length;index++){
      const input=rig.inputs[index];if(input===undefined)throw new Error('Missing creature pose input');
      const joint = input.kind === 'joint' ? rig.joints.get(input.joint) : undefined;
      const record = input.kind === 'scalar' ? input.record === 'declared' ? rig.scalars : input.record === 'memory' ? rig.memory : dimensions : undefined;
      const value = input.kind === 'frame' ? frame[input.field] : input.kind === 'scalar'
        ? record !== undefined && Object.hasOwn(record, input.name) ? record[input.name] : undefined : input.kind === 'look' ? rig.look[input.axis]
        : joint?.[input.transform][input.axis];
      if (value === undefined || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new NumericInputError(input.input);
      rig.observation.values[index] = value;
    }
    rig.observation.time = c.t; rig.observation.delta = c.dt;
    rig.lane?.evaluate(rig.observation);
    for(let index=0;index<rig.turns.length;index++){
      const turn=rig.turns[index];if(turn===undefined)throw new Error('Missing creature pose rotation');
      if(turn.dirty){turn.dirty=false;turn.euler.set(turn.x,turn.y,turn.z);}
    }
    const body = row.squash === undefined ? undefined : c.bones[row.squash];
    if (body !== undefined) squashBody(body, c.flinch);
    } catch(error) {
      if(!(error instanceof NumericInputError))throw error;
      if(!reported.has(c.animal)){reported.add(c.animal);emitFault({system:`creature.${row.group}`,error,verdict:'uncaught'});}
    } finally { available = observation; }
  };
}
