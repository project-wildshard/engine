import type { LevelContext } from '@wildshard/engine/level/context';
import type { SimHost } from '@wildshard/engine/sim';
import { WeatherContinuation } from '@wildshard/engine/world/weatherContinuation';
import type { DayCycleClock } from '@wildshard/engine/world/dayCycle';
import * as v from 'valibot';
import { Vector3 } from 'three';
import { Wind } from '@wildshard/engine/world/steppeWind';
import { WeatherWorldSchema, WindStateSchema, type WeatherProgram } from '@wildshard/format/weatherProgram';
import { NativeWildEnvironment } from '../population/nativeManager';
import { mountedPlayerOf } from '../riding/native';
import { nativePopulationOf } from '../riding/nativePopulation';
import { installWeatherReactions, weatherWorldLight, type nativeWeatherBundle, type WeatherListener, type WeatherReactions } from './reactions';
import type { NativeCombatFrame } from '../plugin/nativeItems';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { publishStorm, publishWeather } from './wire';

/** A page borrows its existing system service; native composites retain their own snapshot/step adapter. */
export interface WeatherInstallation { readonly seed:number; readonly system?:LevelContext['system']; readonly state?:{readonly paused:boolean} }
/** Native world observations consumed by the shared weather installation. */
export interface NativeWeatherWorld { program: ReturnType<typeof nativeWeatherBundle>; rows: unknown;
  clock: Pick<DayCycleClock,'sunElevation'>; env: NativeWildEnvironment;
  bake: { readonly trees: readonly (readonly [number,number,number])[]; readonly tops: readonly number[] };
  /** What a strike scares; absent, the host's native population. */
  scare?: (x: number, z: number, radius: number) => void }
/** The player after `player` in join order, wrapping; the first for null. */
function playerAfter(host: SimHost, player: PlayerSim | null): PlayerSim {
  let first: PlayerSim | undefined, seen = player === null;
  for (const candidate of host.players.values()) {
    if (seen) return candidate;
    first ??= candidate; seen = candidate === player;
  }
  if (first === undefined) throw new Error('Simulation host has no player');
  return first;
}
/** Install DATA weather on a native cadence or a declared page system. Without a cadence declaration the caller's
 * existing composite (weather + native lightning) drives update and saves the historic combined envelope. */
export function installWeatherContinuation(host: SimHost, rows: NativeWeatherWorld): { wind: Wind; storm: WeatherReactions; getLow: (player: string) => boolean };
export function installWeatherContinuation(host: SimHost | WeatherInstallation, rows: WeatherProgram, day: Pick<DayCycleClock,'phase'>, mode: string | undefined, frame?: NativeCombatFrame): WeatherContinuation;
export function installWeatherContinuation(host: SimHost | WeatherInstallation, rows: WeatherProgram | NativeWeatherWorld, day?: Pick<DayCycleClock,'phase'>, mode?: string, frame?: NativeCombatFrame): WeatherContinuation | { wind: Wind; storm: WeatherReactions; getLow: (player: string) => boolean } {
  if ('program' in rows) {
    if (!('level' in host)) throw new Error('Weather world requires its native host');
    const ports = rows;
    const worldRows = v.parse(WeatherWorldSchema,ports.rows), { env,clock,bake,program } = ports;
    if (!(env instanceof NativeWildEnvironment) || bake.trees.length !== bake.tops.length) throw new Error('Invalid native weather observations');
    const wind = new Wind({ value: 1 });
    const storm = installWeatherReactions(installWeatherContinuation(host,program.weather,{ phase: 0 },undefined),
      { ...program.reactions,points: bake.trees.map(([x,z],index) => [x,z,bake.tops[index] ?? 0]) },{ host });
    Object.assign(storm.inputs,{ calmSpeed: wind.speed,calmDir: wind.dir,calmGust: wind.gustiness,held: 0,crouched: 0,mounted: 0 });
    storm.on('strike',event => {
      const scare = ports.scare ?? nativePopulationOf(host)?.scare; if (scare === undefined) throw new Error('Missing native weather population');
      scare(event['x'] ?? 0,event['z'] ?? 0,worldRows.scareRadius);
    });
    publishStorm(host,storm);
    storm.on('wind',event => { wind.setTarget(event['speed'] ?? wind.speed,event['dir'] ?? wind.dir,event['gustiness'],event['seconds']); });
    // One sky over the room: each bolt hunts one player, the next the one after, and hurts whoever stands under it.
    let focus = playerAfter(host, null), struck = false;
    storm.on('strike',() => { struck = true; });
    const hurt = (player: PlayerSim, event: Readonly<Record<string, number>>): void => { host.combat.hit({ source: 'env',sourceTags: worldRows.hit.tags,target: player.health,amount: host.events.ask(worldRows.hit.ask,event['damage'] ?? 0),
      point: player.position.clone(),dir: new Vector3(),cause: worldRows.hit.cause,toast: worldRows.hit.toast }); };
    storm.on('hurt',event => { hurt(focus,event); });
    const posed = (player: PlayerSim): WeatherListener => ({ id: player.id, read: inputs => { const seat = mountedPlayerOf(host,player.id); Object.assign(inputs,{ px: player.position.x,py: player.position.y,pz: player.position.z,crouched: Number(seat?.rider.crouching === true),mounted: Number(seat?.mounted === true) }); },hear: event => { hurt(player,event); } });
    storm.serve({ event: 'hurt',others: function* others() { for (const player of host.players.values()) if (player !== focus) yield posed(player); } });
    const turn = (next: PlayerSim): void => { if (next !== focus) storm.pass(focus.id,next.id); focus = next; };
    const view = (): void => {
      env.light = weatherWorldLight(worldRows.light,clock.sunElevation,storm.stormActive); env.storm = storm.stormActive;
      env.wind.x = wind.dirX; env.wind.z = wind.dirZ; env.wind.strength = Math.min(1,wind.speed/worldRows.windReference);
    };
    const saved = v.strictObject({ wind: WindStateSchema,storm: v.unknown(),focus: v.optional(v.string()) });
    host.onStep(worldRows.step,dt => {
      if (!host.players.has(focus.id)) turn(playerAfter(host,null));
      wind.update(dt); const player = focus.position;
      Object.assign(storm.inputs,{ px: player.x,py: player.y,pz: player.z,crouched: Number(env.playerCrouched),mounted: Number(env.playerMounted) });
      if (focus !== playerAfter(host,null)) posed(focus).read(storm.inputs);
      storm.update(dt); view();
      if (struck) { struck = false; turn(playerAfter(host,focus)); }
    },{ snapshot: () => { const state = wind.snapshot(); return { wind: { ...state,target: { ...state.target } },storm: storm.snapshot(),...(focus === playerAfter(host,null) ? {} : { focus: focus.id }) }; },restore: value => { const state = v.parse(saved,value); wind.restore(state.wind); storm.restore(state.storm); view();
      const player = state.focus === undefined ? playerAfter(host,null) : host.players.get(state.focus); if (player === undefined) throw new Error('Unknown storm focus'); focus = player; } });
    const low = storm.rows.hud?.low;
    view(); return { wind,storm,getLow: player => low !== undefined && storm.ownRegister(player,focus.id,low) === 1 };
  }
  if (day === undefined) throw new Error('Weather requires its day clock');
  const air=new WeatherContinuation(rows,{seed:'level' in host?host.level.seed:host.seed,mode:mode??'live'});
  if ('level' in host) publishWeather(host,air);
  if ('level' in host && rows.air!==undefined) {
    const step = rows.air.step;
    host.events.answer('weather.rain', request => request.id === step ? { ...request, rain: air.rain } : request, host.scope);
    const gust=air.gust;if(gust===null)throw new Error('Missing declared weather wind clock');
    if(frame!==undefined)frame.wind={clock:gust.current,field:rows.air.field,base:rows.air.base,scale:rows.air.scale};
    host.onStep(rows.air.step,dt=>{air.step(dt,day.phase);if(frame!==undefined)frame.rain=air.rain;},{
      snapshot:()=>air.captureContinuation(),restore:value=>{air.prepareContinuationRestore(value)();},
    });
  } else if ('system' in host) {
    const page=rows.page;if(page===undefined)throw new Error('Missing declared page weather system');
    host.system({...page,phase:'update',run:dt=>{if(!host.state?.paused)air.update(dt,day.phase);}});
  }
  return air;
}
