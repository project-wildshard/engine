import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import { CrowdPresentationSchema, CrowdGuardSchema } from '@wildshard/format/crowdPresentation';
import { FlockSchema, parseFlock } from '@wildshard/format/crowds';
import { app } from '@wildshard/engine/app/runtime';
import * as v from 'valibot';
import { prepareDeclaredCrowds, type PreparedCrowds, type CrowdObservation } from '@wildshard/engine/game/shardfile/crowdRuntime';
import { terrainHeight as heightAt, terrainNormal as normalAt } from '@wildshard/engine/world/terrainHeight';
import { Vector3 } from 'three';
import { CrowdDraw as Flock, type CrowdBody as FlockBody } from './crowdDraw';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';
import { folderRiggedHulls } from '../looks/riggedHulls';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { pageAir } from '../population/pageAir';
import { wirePage } from '../shardfile/wirePage';

interface FlockOpts { x: number; z: number; count: number; seed: number; range?: number }

/** Native observation/view bridge; sheep shaders, prey, dog identities and render-frame ordering stay G51. */
export interface PageCrowdViews {
  runtime: PreparedCrowds;
  factory: (options: FlockOpts, index: number) => Flock;
  advance: (view: Flock, index: number, speed: number, player: Vector3, dt: number, time: number, step: PreparedCrowds['advance']) => void;
}

const number = v.pipe(v.number(), v.finite());
const PageCrowdsSchema = v.strictObject({ slug: v.string(), hull: v.nullable(v.string()),
  guard: v.optional(CrowdGuardSchema),
  bounds: v.tuple([number, number, number, number]),
  rows: v.array(FlockSchema), view: CrowdPresentationSchema,
  material: v.strictObject({ rim: number, bands: number }),
});
/** Client-only native crowd/view roster. All placement, bounds, materials and
 * hull identities are admitted rows; it borrows the installed terrain and
 * perception authorities without an author factory or frame callback. */
export function createPageCrowds(sky: SkyRig, seed: number, body: FlockBody, input: unknown, dogWolves: readonly Animal[] = []): PageCrowdViews {
  const data = v.parse(PageCrowdsSchema, input);
  // Native rows omit page-only sound operations but keep their real decision
  // outputs. Consume those values with the admitted cue and position offset.
  const sounds=data.guard?.projection.operations.filter(operation=>operation.kind==='sound-position')??[];
  const scope=app.levelScope;if(scope===null)throw new Error('Crowd sound needs an entered scope');
  if(sounds.length>0)wirePage.whenLive(scope,client=>client.onView(({name,args})=>{
    if(!name.startsWith('creature.output:'))return;
    const [x,y,z,value]=args;if(x===undefined||y===undefined||z===undefined||value===undefined||value===0)return;
    const channel=name.slice('creature.output:'.length);
    for(const sound of sounds)if(sound.value.kind==='channel'&&sound.value.name===channel)
      app.events.emit('creature.sound',{cue:sound.cue,x,y:y+sound.height,z});
  }));
  const rows = data.rows.map(row => parseFlock({ ...row, seed: seed + row.seed }));
  if(data.guard?.projection.operations.some(operation=>operation.kind==='state'&&operation.states.some(state=>!ANIMAL_STATES.some(value=>value===state)))===true)throw new Error('Invalid crowd guardian states');
  if (data.bounds[0] >= data.bounds[1] || data.bounds[2] >= data.bounds[3]) throw new Error('Invalid crowd placement bounds');
  const views = new Map<string, Flock>(), observations = new Map<string, CrowdObservation>();
  const runtime = prepareDeclaredCrowds(rows, { flock: row => {
    const observation: CrowdObservation = { player: new Vector3(), playerSpeed: 0, wolves: dogWolves, dog: null };
    observations.set(row.id, observation);
    return { ports: { heightAt, normalY: (x, z) => normalAt(x, z)[1],
      inBounds: (x, z, margin) => x >= data.bounds[0] + margin && x <= data.bounds[1] - margin && z >= data.bounds[2] + margin && z <= data.bounds[3] - margin,
      wetAt: (x, z) => pageAir.wetAt(x,z), playerCrouched: () => pageAir.playerCrouched,
      grassHeightAt: (x, z) => pageAir.grassHeightAt(x, z), trample: (...values) => { pageAir.trample(...values); }, centre: () => undefined },
    observe: () => observation,
    sound: (cue, x, z) => { const view=views.get(row.id);if(view!==undefined)app.events.emit('creature.sound',{cue,x,y:heightAt(x,z),z}); },
    present: (_policy, time, moved) => {
      const view = views.get(row.id); if (view === undefined) throw new Error('Missing native crowd view');
      view.project(moved ? time : undefined);
    } };
  } });
  runtime.initialize();
  return { runtime, factory: (options, index) => {
    const row = rows[index], policy = row === undefined ? undefined : runtime.policies.get(row.id);
    if (row === undefined || policy === undefined || views.has(row.id) || row.x !== options.x || row.z !== options.z
      || row.count !== options.count || row.seed !== options.seed || row.range !== (options.range ?? 45)) throw new Error('Unbound native crowd roster');
    const view = new Flock(policy,body,painterlyMaterial(sky,data.material),data.view);
    if (data.hull !== null) folderRiggedHulls(data.slug).load(data.hull).then(rig=>{view.useRig(rig);return null;}).catch((cause:unknown)=>{throw new Error('Crowd rig failed',{cause});});
    views.set(row.id, view); return view;
  }, advance: (view, index, speed, player, dt, time, step) => {
    const row = rows[index], observation = row === undefined ? undefined : observations.get(row.id);
    if (row === undefined || observation === undefined || views.get(row.id) !== view) throw new Error('Unbound native crowd view');
    observation.player = player; observation.playerSpeed = speed; observation.dog = view.dog;
    step(row.id, dt, time);
  } };
}
