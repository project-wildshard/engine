/** Client-only ambient assembly. Rows select actual flock draws, packed
 * populations, discovery and timed tools; ABI-v1 guests own content decisions.
 * No shard callback, subclass or reflected owner/path is accepted. */
import * as THREE from 'three';
import { Rng } from '@wildshard/engine/core/rng';
import { app } from '@wildshard/engine/app/runtime';
import { TickScheduler } from '@wildshard/engine/app/scheduler';
import { PlaceGuide, type GuidePoint } from '@wildshard/engine/quest/view';
import { audioRandom } from '@wildshard/engine/audio/util';
import { CameraFX } from '@wildshard/engine/player/CameraFX';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { smoothstep } from '@wildshard/engine/core/noise';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { installCombatTargets } from '../shardfile/clientTargets';
import type { DeclaredSoundBank } from '@wildshard/engine/audio/declaredBank';
import { ForagerPopulation } from '@wildshard/engine/ai/ambientForager';
import { installEnteredRuntimeObserver, installEnteredRuntimeService, retainsRuntimeServices } from '../shard/retainedHooks';
import { sharedWeaponVoices } from '../plugin/audio';
import type { ShardContext } from '../plugin/context';
import { HeldEquipment } from '../plugin/heldEquipment';
import type { CompendiumState } from '../../../shared/game/compendium/state';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { AmbientGroup, type AmbientVisitorPlayer } from '../../../shared/game/ambient/flock';
import { parsePageLife, type PageLifeRows } from '@wildshard/format/pageLife';
import { CrowdRoster, CrowdWeaponTarget, ForagerTargets } from '../../../shared/game/shardfile/crowdRuntime';
import { type AmbientFlockDraw, createAmbientFlock, installAmbientFlock } from '../ambient/ambientFlock';
import { PosedDraw } from '../looks/posedInstances';
import { PosedBufferPool } from '../looks/posedBufferPool';
import { lendLooks } from '../shardfile/lentLooks';
import { runtimeLookMaterials } from '../shardfile/runtimeProduct';

interface Pose {kind:number;x:number;y:number;z:number;yaw:number;pitch:number;roll:number;scale:number;a0:number;a1:number;a2:number;a3:number;b1:number;b2:number}
const newPose=(kind:number):Pose=>({kind,x:0,y:-999,z:0,yaw:0,pitch:0,roll:0,scale:1,a0:0,a1:0,a2:0,a3:0,b1:0,b2:0});
interface Carcass { a: Animal; killT: number; comeT: number; harvestT: number; site: number; dimmed: boolean }
interface HarvestPlayback {
  update: (dt: number) => void; busy: () => boolean; beat: () => number;
}
export interface PageLife {
  readonly mesh: THREE.InstancedMesh | undefined;
  readonly busy: boolean;
}
function beatEnvelope(t:number,beat:NonNullable<PageLifeRows['harvest']>):number {if(t<=0||t>=beat.len)return 0;const ease=(u:number):number=>u*u*(3-2*u);if(t<beat.kneelIn)return ease(t/beat.kneelIn);if(t>beat.rise)return ease(1-(t-beat.rise)/(beat.len-beat.rise));return 1;}

/** Concrete page services only. The admitted row owns the layout and policy;
 * the optional loans are platform instances, never per-content callbacks. */
export async function installPageLife(ctx: ShardContext, input: unknown, journal: CompendiumState | null = null,
  sounds: DeclaredSoundBank | null = null, borrowed: ReadonlyMap<string, AmbientFlockDraw> = new Map()): Promise<PageLife> {
  const live = (): void => { if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Ambient page owner has ended'); };
  live();
  const data = parsePageLife(input), runtime = ctx.game.runtime, world = runtime?.world;
  if (runtime === undefined || world === undefined || world === null) throw new Error('Ambient page needs its world');
  const { game, sky, player } = world, cam = game.camera, hooks = runtime.hooks;
  const library = data.draw === null ? null : await PosedDraw.library(ctx.product, data.draw.library); live();
  await library?.preload(); live();
  const retained = retainsRuntimeServices(ctx);
  let lifeTime = app.clock.now;
  const now = (): number => retained ? lifeTime : app.clock.now;
  const rng = new Rng(data.seed), fwd = new THREE.Vector3();
  // Only the page's own guide draws share storage. Borrowed and independently
  // loaded flocks retain their separate ownership and upload lifetimes.
  const guideCapacity = data.flocks.reduce((sum, entry) => sum + (!entry.borrowed && !entry.packed && entry.library === undefined ? entry.row.count : 0), 0);
  const capacity = (data.draw?.capacity ?? 0) + guideCapacity;
  const buffers = data.draw !== null && library !== null && guideCapacity > 0 && capacity <= 4096 ? new PosedBufferPool(ctx.scope, capacity) : undefined;
  const wild = data.draw === null ? null : library?.draw(data.draw.capacity, buffers) ?? null;
  if (wild !== null) game.scene.add(wild.mesh);
  const groups = new Map<string, AmbientGroup>(), packed: AmbientGroup[] = [], separate: AmbientFlockDraw[] = [];
  for (const entry of data.flocks) {
    if (groups.has(entry.id)) throw new Error('Duplicate ambient group');
    if (entry.borrowed) {
      const draw = borrowed.get(entry.id); if (draw === undefined) throw new Error('Missing actual ambient draw');
      if (JSON.stringify(draw.row) !== JSON.stringify(entry.row)) throw new Error('Ambient draw row differs');
      groups.set(entry.id, draw.flock); separate.push(draw);
    } else if (entry.packed) {
      if (wild === null) throw new Error('Packed ambient group needs its draw');
      const group = new AmbientGroup(entry.row, entry.perches); groups.set(entry.id, group); packed.push(group);
    } else if (entry.library !== undefined) {
      const own = await PosedDraw.library(ctx.product, entry.library); live(); await own.preload(); live();
      // as a graph on every tier (a boot pass with graph materials off lends its classic fallback)
      const looks = await runtimeLookMaterials(ctx, ctx.product.shardfile, true, [own.name]); live();
      lendLooks(ctx.scope, looks);
      const draw = createAmbientFlock(entry.row, own.look(), entry.perches), tint = new THREE.Color();
      for (const [i, hex] of (entry.tints ?? []).entries()) draw.mesh.setColorAt(i, tint.setHex(hex));
      game.scene.add(draw.group); installAmbientFlock(ctx, draw, entry.anchor === undefined ? player : { position: entry.anchor }); groups.set(entry.id, draw.flock);
    } else {
      if (wild === null) throw new Error('Ambient guide needs its model library');
      const channels: readonly [string, string?] = entry.row.attributes[1] === null ? [entry.row.attributes[0]] : [entry.row.attributes[0], entry.row.attributes[1]];
      const look = buffers?.configured === true && buffers.supports(channels) ? { ...wild.look, buffers } : wild.look;
      const draw = createAmbientFlock(entry.row, look, entry.perches);
      wild.mesh.add(draw.group); installAmbientFlock(ctx, draw, player); groups.set(entry.id, draw.flock);
    }
  }
  const group = (id: string): AmbientGroup => { const value = groups.get(id); if (value === undefined) throw new Error('Unknown ambient group'); return value; };
  const program = data.program === undefined ? null : ReturnProgram.page(data.program, ctx.scope);
  const project = (signal: string, fields: Readonly<Record<string,number>>): Readonly<Record<string,number>> => {
    if (program === null) throw new Error('Ambient rule requires its admitted guest');
    return program.project(signal, fields);
  };
  const arrival = (time:number,draw:number,scale:number):number => {
    const row = data.carcasses; if (row === undefined) return time;
    const value = project('arrival',{now:time,draw,scale,minimum:row.arrival[0],maximum:row.arrival[1]})['arrival'];
    if (value === undefined) throw new Error('Missing ambient arrival'); return value;
  };
  const carcasses: Carcass[] = [], harvestColors = new WeakMap<Carcass, { original: THREE.Color; dimmed: THREE.Color }>();
  const animals = runtime.play?.animals, weapons = runtime.play?.weapons, audio = runtime.play?.audio;
  if (data.carcasses !== undefined) {
    if (animals === undefined) throw new Error('Carcass ownership needs the real population');
    const row = data.carcasses;
    ctx.on('actor.died', ({ actor }) => {
      const a = animals.animals.find(candidate => candidate.combatActor() === actor);
      if (a === undefined || !Object.hasOwn(row.visitors,a.kind)) return;
      const t = now(); carcasses.push({a,killT:t,comeT:arrival(t,rng.next(),1),harvestT:-1,site:-1,dimmed:false});
    });
  }
  const dim = (c:Carcass):void => {
    if (c.dimmed || animals === undefined || data.carcasses === undefined) return;
    c.dimmed=true;
    const mats=Array.isArray(c.a.mesh.material)?c.a.mesh.material:[c.a.mesh.material],fur=mats[0];
    if (!(fur instanceof THREE.MeshStandardMaterial)) return;
    if (animals.animals.some(other => other!==c.a && (Array.isArray(other.mesh.material)?other.mesh.material.includes(fur):other.mesh.material===fur))) return;
    const original=retained?fur.color.clone():undefined;fur.color.multiplyScalar(data.carcasses.tint);
    if(original!==undefined)harvestColors.set(c,{original,dimmed:fur.color.clone()});
  };
  const updateCarcasses = (t:number):void => {
    const row=data.carcasses;if(row===undefined||animals===undefined)return;
    const flock=group(row.group),pp=player.position;
    for(let k=0;k<256;k++) {
      const i=carcasses.length-1-k;if(i<0)break;const c=carcasses[i];if(c===undefined)continue;
      const fields={now:t,present:!c.a.hidden&&animals.animals.includes(c.a)?1:0,kill:c.killT,arrival:c.comeT,harvest:c.harvestT,
        site:c.site,visit:flock.siteVisit(c.site),distance:Math.hypot(c.a.position.x-pp.x,c.a.position.z-pp.z),reach:row.reach,giveUp:row.giveUp};
      let action=project('carcass',fields);
      if(action['gather']!==undefined) {
        c.site=action['gather']===1?flock.gather(c.a.position.x,c.a.position.z,row.bodyWidths[c.a.kind]??row.defaultWidth,row.visitors[c.a.kind]??row.defaultVisitors):-2;
        if(c.site<0)c.site=-2;
        action=project('carcass',{...fields,site:c.site,visit:flock.siteVisit(c.site)});
      }
      if(action['dim']===1)dim(c);
      if(action['fade']===1)c.a.fadeOut();
      if(action['remove']===1){if(c.site>=0)flock.release(c.site,pp);carcasses.splice(i,1);}
    }
  };
  const guideRow=data.guide,guideFlock=guideRow===undefined?null:group(guideRow.group);
  const guide=guideRow===undefined?null:new PlaceGuide(guideRow.policy,{
    points:()=>journal?.def.entries.flatMap(entry=>entry.place?[{id:entry.id,...entry.place}]:[])??[],
    discovered:(id:string)=>journal?.reached(id,'seen')??true,position:()=>player.position,time:now,random:(lo:number,hi:number)=>rng.range(lo,hi),
    fly:(target:GuidePoint)=>{if(guideFlock?.guide(player.position,target.x,target.z)!==true)return false;
      const lead=guideFlock.birds[0];if(lead!==undefined)sounds?.shot(guideRow.cue,{at:lead,gain:guideRow.gain});return true;},
  });
  let night=0;
  const reader:AmbientVisitorPlayer={get x(){return player.position.x;},get y(){return player.position.y;},get z(){return player.position.z;},
    get fast(){return player.sprinting;},get light(){return night;},get fx(){return fwd.x;},get fz(){return fwd.z;},get toward(){return guide?.target()??null;}};
  const foragers=data.foragers.map(row=>({row,population:new ForagerPopulation(row.row,data.seed,world.forest.trees).roam(reader),pose:newPose(row.model)}));
  const weaponTargets = foragers.flatMap(({ row, population }) => row.combat === undefined ? []
    : [new CrowdWeaponTarget(new CrowdRoster([], [new ForagerTargets(population, row.combat, row.scale)]), row.combat.target)]);
  if (weaponTargets.length > 0) installCombatTargets(ctx, { ray: { result: 'in-place', sources: weaponTargets.map((_, index) => `crowd.${index}`) } },
    new Map(weaponTargets.map((target, index) => [`crowd.${index}`, target])));
  const pose=newPose(0),lane=(bird:AmbientGroup['birds'][number],value:AmbientGroup['row']['channels'][0][number]):number=>typeof value==='number'?value:bird[value];
  const drawFlock=(flock:AmbientGroup):void=>{
    if(wild===null)return;const [a,b]=flock.row.channels;
    for(let i=0;i<8;i++){const call=flock.calls[i];if(call===undefined)break;sounds?.shot(call.cue,{at:call,gain:call.gain});}
    for(const bird of flock.birds){if(bird.state===0)continue;
      pose.x=bird.x;pose.y=bird.y;pose.z=bird.z;pose.yaw=bird.yaw;pose.pitch=bird.pitch;pose.roll=bird.roll;pose.scale=flock.row.scale;
      pose.a0=lane(bird,a[0]);pose.a1=lane(bird,a[1]);pose.a2=lane(bird,a[2]);pose.a3=lane(bird,a[3]);
      pose.kind=b===null?0:lane(bird,b[0]);pose.b1=b===null?0:lane(bird,b[1]);pose.b2=b===null?0:lane(bird,b[2]);wild.add(pose);
    }
  };
  function installHarvest(): HarvestPlayback | undefined {
    if (animals === undefined || weapons === undefined || audio === undefined) {if(data.harvest!==undefined)throw new Error('Timed harvest needs its player services');return undefined;}
  // ── the skinning beat (F2) ──
  const BEAT = data.harvest;
  if (BEAT === undefined) return undefined;
  const voice = (family: string, gain: number): boolean => sounds?.shot(family, { gain }) ?? false;
  let beatCancel: (() => void) | undefined;
  let beatT = -1, beatCarcass: Animal | null = null, beatGive: (() => void) | null = null, cutsDone = 0;
  let addPitch = 0, addY = 0, lastRx = Number.NaN, lastPy = Number.NaN;
  const fx = CameraFX.for(game);
  // the gloved hand and the skinning knife the strokes are made with (the weapon is holstered for the beat)
  const knife = HeldEquipment.current(ctx.manifest.slug).tool(ctx, BEAT);
  let interrupted: { enabled: boolean; visible: boolean } | undefined;
  let previousWeapons: { enabled: boolean; visible: boolean } | undefined;
  const harvest = (carcass: Animal, give: () => void, cancel?: () => void): void => {
    if (beatT >= 0) { beatGive?.(); } // a second harvest mid-beat (never, the prompt hides): the first one's drops land now
    if (retained && beatT < 0) previousWeapons = { enabled: weapons.enabled, visible: weapons.visible };
    beatCancel = cancel;
    beatT = 0; beatCarcass = carcass; beatGive = give; cutsDone = 0;
    weapons.setEnabled(false); weapons.visible = false;
    audio.footstep(false, BEAT.surface); // kneeling in the needles
    if (data.carcasses !== undefined) {
      const c = carcasses.find((k) => k.a === carcass);
      if (c) c.harvestT = now();
      else carcasses.push({ a: carcass, killT: now() - data.carcasses.untrackedAge, comeT: arrival(now(), rng.next(), data.carcasses.harvestDelay), harvestT: now(), site: -1, dimmed: false });
    }
  };
  const updateBeat = (dt: number): void => {
    // take last frame's offset back when nothing rewrote the camera since (Player.update rewrites it every frame)
    if (cam.rotation.x === lastRx && cam.position.y === lastPy) { cam.rotation.x -= addPitch; cam.position.y -= addY; }
    addPitch = 0; addY = 0;
    if (beatT < 0) { lastRx = Number.NaN; lastPy = Number.NaN; knife.update(-1); return; }
    beatT += dt;
    knife.update(beatT);
    const env = beatEnvelope(beatT,BEAT);
    // kneel: down 0.55 m and the view tipped toward the carcass (at most ~35°, never past it)
    let tip = BEAT.camera.defaultPitch;
    if (beatCarcass) {
      const a = beatCarcass.position, dx = a.x - cam.position.x, dz = a.z - cam.position.z, dy = a.y + BEAT.camera.targetY - (cam.position.y - BEAT.camera.down);
      const want = Math.atan2(dy, Math.hypot(dx, dz)); // negative = below
      tip = THREE.MathUtils.clamp(-(want - cam.rotation.x), 0, BEAT.camera.maxPitch);
    }
    addPitch = -tip * env; addY = -BEAT.camera.down * env;
    const cut = BEAT.cuts[cutsDone];
    if (cut !== undefined && beatT >= cut) {
      cutsDone++;
      if (!voice(cutsDone % 2 === 1 ? BEAT.sounds[0] : BEAT.sounds[1], BEAT.gain)) sharedWeaponVoices(audio).swordHit(BEAT.fallbackSurface, (audioRandom() - 0.5) * BEAT.fallbackPan, BEAT.fallbackGain);
      fx.kick(BEAT.kick[0], cutsDone % 2 === 0 ? BEAT.kick[1] : -BEAT.kick[1]);
    }
    if (beatT >= BEAT.len) {
      beatT = -1; beatCarcass = null; beatCancel = undefined;
      const give = beatGive; beatGive = null; give?.();
      if (!player.swimming) { weapons.setEnabled(true); weapons.visible = true; }
    }
    cam.rotation.x += addPitch; cam.position.y += addY;
    lastRx = cam.rotation.x; lastPy = cam.position.y;
  };

  if (retained) installEnteredRuntimeService(ctx, (scope) => {
    // Only the next home entry may release an interrupted harvest hold; never reveal a stowed weapon on the road.
    if (interrupted !== undefined) {
      weapons.setEnabled(interrupted.enabled); weapons.visible = interrupted.visible;
      interrupted = undefined;
    }
    scope.onDispose(() => {
      if (beatT >= 0) {
        interrupted = previousWeapons;
        const carcass = carcasses.find((entry) => entry.a === beatCarcass);
        if (carcass !== undefined) {
          const color = harvestColors.get(carcass), materials = carcass.a.mesh.material;
          const fur = Array.isArray(materials) ? materials[0] : materials;
          if (color !== undefined && fur instanceof THREE.MeshStandardMaterial && fur.color.equals(color.dimmed)) fur.color.copy(color.original);
          harvestColors.delete(carcass); carcass.dimmed = false; carcass.harvestT = -1;
        }
        const cancel = beatCancel; beatCancel = undefined; cancel?.();
      }
      if (cam.rotation.x === lastRx && cam.position.y === lastPy) { cam.rotation.x -= addPitch; cam.position.y -= addY; }
      beatT = -1; beatCarcass = null; beatGive = null; cutsDone = 0;
      addPitch = 0; addY = 0; lastRx = Number.NaN; lastPy = Number.NaN;
      knife.update(-1);
    });
  });

  hooks.harvestBusy = () => beatT >= 0;
  hooks.harvest = harvest;
  return { update: updateBeat, busy: () => beatT >= 0, beat: () => beatT };
  }
  const beat=installHarvest();
  const scheduler=new TickScheduler(),ambient={id:`${data.system.id}.decisions`,phase:'update' as const,tick:'fx' as const,run:():void=>undefined};
  let decisionTime=0;
  ctx.system({id:data.system.id,phase:'update',after:data.system.after,before:data.system.before,run:dt=>{
    if(retained)lifeTime+=dt;scheduler.beginFrame(dt,player.position);wild?.begin();beat?.update(dt);
    cam.getWorldDirection(fwd);fwd.y=0;fwd.normalize();night=sky.dayNight?.night??0;
    if(wild!==null&&data.draw!==null)wild.glow.value=smoothstep(0,1,(night-data.draw.glow[0])/(data.draw.glow[1]-data.draw.glow[0]));
    const ambientDt=scheduler.systemDt(ambient,dt);decisionTime+=dt;
    if(ambientDt>0&&decisionTime>=.1){updateCarcasses(now());decisionTime=0;}
    if(ambientDt>0)guide?.update(ambientDt,0,()=>project('guide',{night,combat:runtime.play?.music.state.mode==='combat'?1:0})['eligible']===1);
    for(const flock of packed){flock.update(ambientDt,reader);drawFlock(flock);}
    for(const draw of separate)draw.update(dt,player.position);
    for(const {population,row,pose:p} of foragers){population.update(dt,reader,player.sprinting);
      for(let i=0;i<256;i++){const hr=population.rows[i],motion=population.motion[i];if(hr===undefined||motion===undefined)break;if(population.shown[i]!==1)continue;
        p.x=hr.x;p.y=heightAt(hr.x,hr.z)+motion.y;p.z=hr.z;p.yaw=hr.yaw;p.scale=row.scale;p.a0=motion.hind;p.a1=motion.fore;p.pitch=motion.pitch;
        p.a2=hr.headPitch-hr.sit*row.sitPitch;p.a3=hr.ears;p.b1=hr.mode==='alert'?Math.sin(now()*row.alertRate+i)*row.alertGain:0;wild?.add(p);
      }
    }wild?.commit();
  }});
  const life={mesh:wild?.mesh,get busy(){return beat?.busy()??false;}};
  const debug=data.debug;
  if(debug!==undefined){
    const flockRows=Object.fromEntries(Object.entries(debug.flocks).map(([name,id])=>[name,group(id).birds]));
    const visitors=Object.fromEntries(Object.entries(debug.visitors).map(([name,id])=>[name,group(id).birds[0]]));
    const populations=Object.fromEntries(Object.entries(debug.populations).map(([name,id])=>[name,foragers.find(value=>value.row.row.id===id)?.population.rows??[]]));
    const commands=Object.fromEntries(Object.entries(debug.commands).map(([name,row])=>[name,(x?:number,z?:number):boolean=>{
      const flock=group(row.group);
      if(row.operation==='visit'){if(x===undefined||z===undefined){flock.visitSoon();return true;}return flock.visitAt(x,z,20,reader);}
      const pp=player.position,qx=x??pp.x,qz=z??pp.z;let best:Carcass|undefined,bd=Infinity;
      for(const c of carcasses){const d=Math.hypot(c.a.position.x-qx,c.a.position.z-qz);if(d<bd){bd=d;best=c;}}
      if(best?.site===-1)best.comeT=now();return best!==undefined;
    }]));
    const probe={wild,...flockRows,...visitors,...populations,...commands,carcasses,crumbs:()=>guide?.attempt(true),beat:()=>beat?.beat()??-1};
    ctx.debug.expose(debug.id,probe);installEnteredRuntimeObserver(ctx,debug.window,probe);
  }
  return life;
}
