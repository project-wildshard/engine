/** Client-only weather composition over the page's sky, a phase continuation or a storm's reactions, its drawn parts,
 * native rain presentation and herd shelter. Shards provide rows and resource ids. */
import { forestWeatherObservations, type ForestWeatherObservations } from '../looks/forestWeather';
import type { Scope } from '@wildshard/engine/app/scope';
import { installChannelPrograms } from '../../../shared/game/plugin/channelPrograms';
import { installEnteredRuntimeService, retainsRuntimeServices } from '../shard/retainedHooks';
import * as THREE from 'three';
import { SEED } from '@wildshard/engine/core/config';
import { TIER } from '@wildshard/engine/core/tier';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import { setting, onSettingChange } from '@wildshard/engine/ui/Settings';
import { fogUniforms, weatherUniforms, volumetricFog } from '@wildshard/engine/world/Atmosphere';
import * as v from 'valibot';
import { ForestWeatherSchema, type ForestWeatherRows } from '@wildshard/format/forestWeather';
import { windBoost, windUniforms, WIND_DIR } from '@wildshard/engine/world/wind';
import { wind as steppeWind } from '@wildshard/engine/world/steppeWind';
import type { ClimateFeed, StormReading, WeatherReading } from '../../../shared/game/weather/feed';
import { paintedSky, skyFaceOf, type PaintedSky, type SkyFace } from '../looks/keyedSky';
import { pageSky } from './pageSky';
import type { WeatherHUD } from '@wildshard/engine/ui/HUD';
import { wetFlight } from '@wildshard/engine/combat/ammo';
import { smoothstep } from '@wildshard/engine/core/noise';
import { panFromYaw } from '@wildshard/engine/audio/util';
import { audioVoicePatches } from '../audio/voicePatches';
import { rainCurtainGeometry } from '../systems/looks/rainCurtain';
import { graphParamRoots } from '../looks/graphDaySky';
import { RainPresentation } from './rainPresentation';
import { lentLook, pushLentParams, setLentParam, setLentTexture } from '../shardfile/lentLooks';

declare module '@wildshard/engine/events/maps' {
  interface EventMap { 'weather.changed': WeatherHUD }
}

type ShardContext = Parameters<typeof installEnteredRuntimeService>[0];
type ShardWorld = NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>;
export interface ForestWeatherRig {
  weather: ClimateFeed['weather']; fx: RainPresentation | null; storm: ClimateFeed['storm'];
  /** the rows' painted sky: its clock, the look it painted and its dome */
  sky: PaintedSky | null;
  /** the drawn parts (hidden while dry) */
  group: THREE.Group;
  setMode: (mode: string, at?: number) => void;
}
/** Keep the actual construction owners across every asynchronous intake. */
export function forestWeatherOwner(ctx: ShardContext): () => void {
  const scope = ctx.scope, product = ctx.product, runtime = ctx.game.runtime, world = runtime?.world;
  if (runtime === undefined || world === undefined || world === null) throw new Error('Weather requires its world');
  const game = world.game, sky = world.sky, root = game.scene, owner = game.levelScope, file = product.file, json = product.json;
  return (): void => {
    if (scope.disposed || scope.disposing || owner.disposed || owner.disposing || ctx.scope !== scope || ctx.product !== product || product.file !== file || product.json !== json
      || ctx.game.runtime !== runtime || runtime.world !== world || world.game !== game || world.sky !== sky || game.scene !== root || game.levelScope !== owner)
      throw new Error('Weather construction owner left or changed');
  };
}

type Parts = NonNullable<ForestWeatherRows['parts']>;

/** The page's weather from its rows: the sky's clock and owners, then whichever blocks the rows declare. */
export async function installForestWeather(ctx: ShardContext, input: unknown): Promise<ForestWeatherRig | null> {
  const policy = v.parse(ForestWeatherSchema, input), runtime = ctx.game.runtime, world = runtime?.world;
  if (runtime === undefined || world === undefined || world === null) throw new Error('Weather requires its world');
  const live = forestWeatherOwner(ctx), product = ctx.product;
  live();
  const json = async (file: string): Promise<unknown> => { live(); const value = await product.json(file); live(); return value; };
  const painted = policy.sky === undefined ? null : await paintedSky(product, world.game, world.sky, policy.sky, ctx.app.params, world.chunk.grade.brightness, ctx);
  live();
  const sky = painted ?? skyFaceOf(world.sky);
  if (sky === null) return null; // the fixed sky: no clock, no weather
  const read = async (file: string): Promise<unknown> => { live(); const bytes = await product.file(file); live(); return JSON.parse(new TextDecoder().decode(bytes)); };
  const forest = policy.files.observations === undefined || policy.files.rain === undefined || policy.files.shelter === undefined ? null : {
    h: forestWeatherObservations(ctx, await json(policy.files.observations)),
    fx: await RainPresentation.install(ctx, await json(policy.files.rain)),
  };
  if (policy.storm === undefined && policy.files.program === undefined) throw new Error('Weather requires its program');
  const program = await read(policy.storm?.file ?? policy.files.program ?? '');
  const climate = pageSky(policy, program, sky.clock);
  if (policy.mode === 'setting') climate.setMode(setting('weather'), policy.heldPhase);
  const parts = policy.parts === undefined ? null : await weatherParts(ctx, world, policy.parts, sky);
  live();
  return installWeatherPresentation(ctx, world, { face: sky, painted }, climate, forest, parts, policy, retainsRuntimeServices(ctx) ? ctx : undefined);
}

/** PF6: the weather presentation's slow step (s): its channel programs */
const SLOW_STEP = 0.1;

function installWeatherPresentation(ctx: ShardContext, world: ShardWorld, skies: { face: SkyFace; painted: PaintedSky | null }, climate: ClimateFeed,
  forest: { h: ForestWeatherObservations; fx: RainPresentation } | null,
  parts: Awaited<ReturnType<typeof weatherParts>> | null, policy: ForestWeatherRows, entered?: ShardContext): ForestWeatherRig {
  const { weather } = climate, stormRows = policy.storm, storm = climate.storm === null || stormRows === undefined ? null : { rows: stormRows, reactions: climate.storm };
  const game = world.game, sky = skies.face, group = new THREE.Group(), atT = policy.heldPhase, setMode = (m: string, t = atT): void => { climate.setMode(m, t); };
  group.name = 'weather-fx'; if (forest !== null) group.add(forest.fx.group); if (parts !== null) group.add(parts.group);
  game.scene.add(group); // hidden while dry; in the scene before the boot's precompile, so the programs are built then
  game.levelScope.onDispose(() => { group.removeFromParent(); });
  if (entered === undefined && policy.mode === 'setting') ctx.scope.onDispose(onSettingChange('weather', (m) => { setMode(m); }));
  const jump = ctx.app.params.get('weather');
  if (jump !== null) { const [phase = '', at = '0'] = jump.split(':'); if (weather.rows.states.includes(phase)) climate.force(phase, Number.parseFloat(at) || 0); }

  // ── the forest: the main lane over the sky's multipliers, the fog's focus, wet arrows ──
  const veil = { x: { value: 0 }, y: { value: 0 } }, wind = { x: 0, z: 0 };
  const roots = new Map<string, unknown>([...sky.owners, ...Object.entries({ fog: fogUniforms, weather: weatherUniforms, volume: volumetricFog,
    veil, wind: windBoost, windVector: wind }), ...(forest === null ? [] : Object.entries({ particles: forest.h.particles.params, water: forest.fx.rings }))]);
  const channels = policy.channels === undefined ? null : installChannelPrograms(ctx.product.shardfile.clientChannels, policy.channels, roots);
  const baseH = fogUniforms.fogHeight.value, baseFall = fogUniforms.fogHeightFalloff.value, baseMist = forest?.h.particles.params.mistOpacity ?? 0;
  const answers = (scope: Scope): void => {
    if (weather.rows.wetProjectile !== undefined) { const wet = weather.rows.wetProjectile;
      game.app.events.answer('projectile.modify', (input) => game.app.levelScope === game.levelScope ? (input.ammo.wet === undefined ? input : { ...input, ...wetFlight(input, wet, weather.rain) }) : input, scope); }
  };
  if (entered === undefined) answers(ctx.scope);
  else installEnteredRuntimeService(entered, (scope) => {
    const restore = channels?.capture(), mod = sky.owners.get('mod'), saved = numeric(mod) ? { ...mod } : null, fogBlob = weatherUniforms.fogBlob.value.clone();
    const horizon = forest?.h.horizonVeil?.value.clone();
    answers(scope);
    if (policy.mode === 'setting') scope.onDispose(onSettingChange('weather', (mode) => { setMode(mode); }));
    scope.onDispose(() => {
      restore?.();
      weatherUniforms.fogBlob.value.copy(fogBlob); if (saved !== null && numeric(mod)) Object.assign(mod, saved);
      if (forest?.h.horizonVeil && horizon !== undefined) forest.h.horizonVeil.value.copy(horizon);
      group.visible = false;
    });
    group.visible = true;
  });

  const blob = new THREE.Vector3(-1e4, -1e4, -1e4), focus = policy.focus;
  const focusInFog = (h: ForestWeatherObservations, eye: THREE.Vector3, dt: number): void => {
    if (focus === undefined) return;
    let p = h.guideAt();
    if (p === null) {
      let bd = focus.near * focus.near;
      for (const a of h.animals.animals) {
        if (!a.alive || a.kind !== focus.kind || a.variant !== focus.variant) continue;
        const d = a.position.distanceToSquared(eye);
        if (d < bd) { bd = d; p = a.position; }
      }
    }
    if (p === null || weather.fog < focus.threshold) { weatherUniforms.fogBlobAmt.value = 0; return; }
    blob.lerp(p, blob.y < -1e3 ? 1 : 1 - focus.retention ** (dt * 60));
    weatherUniforms.fogBlob.value.set(blob.x, blob.y + focus.height, blob.z, focus.radius);
    weatherUniforms.fogBlobAmt.value = focus.gain * weather.fog;
  };

  // ── the storm: its cues, beds and HUD, and whether the player is indoors ──
  let indoors = false, bedT = 0, audio: ReturnType<typeof playAudio> = null;
  const playAudio = () => { const a = ctx.game.runtime?.play?.audio; return a === undefined ? null : audioVoicePatches(a); };
  if (storm !== null) {
    const { reactions, rows } = storm, player = world.player;
    const pan = (x: number, z: number): number => panFromYaw(x - player.position.x, z - player.position.z, player.yaw, 0.7, undefined, 1);
    for (const cue of rows.cues) reactions.on(cue.event, (e) => {
      const x = e['x'] ?? 0, z = e['z'] ?? 0, d = Math.hypot(x - player.position.x, z - player.position.z), voices = audio;
      if (voices === null) return;
      if (cue.kind === 'near') { if (d < cue.range) voices.play(cue.patch, { pan: pan(x, z), gain: Math.max(cue.floor, 1 - d / cue.range) }); return; }
      const bearing = e['bearing'] ?? 0;
      voices.play(cue.patch, { distance: e['distance'] ?? 0, pan: pan(player.position.x + Math.cos(bearing) * cue.reach, player.position.z + Math.sin(bearing) * cue.reach) });
    });
  }
  const stormFrame = (dt: number): void => {
    if (storm === null) { climate.frame(dt, null); return; }
    const { reactions, rows } = storm;
    indoors = game.app.events.ask('weather.indoors', 0) > 0;
    climate.frame(dt, null);
    const hud = reactions.hud(steppeWind.speed, indoors);
    if (hud !== null) game.app.events.emit('weather.changed', hud);
    audio ??= playAudio();
    bedT -= dt;
    if (bedT <= 0 && audio !== null) {
      bedT = rows.beds.every;
      audio.setGroup(rows.beds.group, { [rows.beds.rain]: indoors ? 0 : weather.rain,
        [rows.beds.wind]: indoors || weather.state === rows.idle ? 0 : smoothstep(rows.beds.range[0], rows.beds.range[1], steppeWind.speed) });
    }
  };

  // PF6: the channel programs (fog, mist and the wind boost, from the weather's own 10 Hz state, the eye and the gust) step at
  // 10 Hz with the time since their last step (their first frame steps at once); the rain and the fog's focus stay per frame
  let slowDue = SLOW_STEP;
  const update = (dt: number): void => {
    slowDue += dt;
    const slowDt = slowDue >= SLOW_STEP ? slowDue : 0; if (slowDt > 0) slowDue = 0;
    stormFrame(dt);
    skies.painted?.frame(dt, { overcast: weather.overcast, rain: weather.rain, wet: weather.wet, flash: storm?.reactions.flash ?? 0, indoors });
    const eye = ctx.game.runtime?.viewer() ?? game.camera.position;
    const room = practiceRoom.open;
    if (channels !== null && slowDt > 0) channels.evaluate({ time: 0, delta: slowDt, values: [weather.overcast, weather.fog, weather.rain, weather.wet, weather.wind, windUniforms.uGust.value,
      game.app.events.ask('weather.hold', 0), eye.x, eye.z, baseH, baseFall, baseMist, Number(room), WIND_DIR.x, WIND_DIR.z] }); // a sealed boss room's own fog wins (F-L7)
    if (forest !== null) {
      if (forest.h.horizonVeil) forest.h.horizonVeil.value.set(veil.x.value, veil.y.value);
      forest.h.ambience.inputs['rain'] = room ? 0 : weather.rain;
      forest.fx.update(dt, weather, wind, game.camera);
      focusInFog(forest.h, eye, dt);
    }
    if (parts !== null) parts.update(dt, weather, storm?.reactions ?? null, storm?.rows.idle ?? null, indoors);
  };
  ctx.system({ ...policy.system, phase: 'update', run: update });

  const rig: ForestWeatherRig = { weather, fx: forest?.fx ?? null, storm: storm?.reactions ?? null, sky: skies.painted, group, setMode };
  ctx.debug.expose(policy.debug, {
    ...rig, clock: sky.clock, uniforms: { weatherUniforms, fogUniforms, waterWeather: forest?.fx.rings, windBoost, sky: sky.owners },
  });
  return rig;
}

function numeric(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null && Object.values(value).every(field => typeof field === 'number');
}

/** The rows' drawn parts: the baked shapes in their lent looks, the sprites, the rain round the eye, posed by one lane over
 *  the weather's numbers, the reactions' event records, the sky's owners, the wind and the camera. */
async function weatherParts(ctx: ShardContext, world: ShardWorld, rows: Parts, sky: SkyFace) {
  const live = forestWeatherOwner(ctx); live();
  const input = await ctx.product.json(rows.file); live();
  const file = v.parse(v.objectWithRest({ shapes: v.record(v.string(), v.unknown()) }, v.unknown()), input);
  const table = (id: string): number[] => v.parse(v.array(v.number()), file[id]);
  const channels = ctx.product.shardfile.clientChannels, loader = new THREE.BufferGeometryLoader(), game = world.game;
  const group = new THREE.Group(), meshes = new Map<string, THREE.Object3D>(), owned: { dispose: () => void }[] = [];
  const textures = new Map<string, THREE.DataTexture>();
  for (const row of rows.textures) {
    const t = new THREE.DataTexture(Uint8Array.from(table(row.bytes)), row.size, row.size);
    t.magFilter = THREE.LinearFilter; t.minFilter = row.noise ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.generateMipmaps = row.noise;
    if (row.noise) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true; textures.set(row.id, t); owned.push(t);
    for (const [look, name] of row.lend) setLentTexture(look, name, t);
  }
  const owners = new Map<string, unknown>();
  for (const row of rows.parts) {
    let part: THREE.Object3D;
    if (row.kind === 'sprite') {
      const map = textures.get(row.texture); if (map === undefined) throw new Error(`Missing weather texture: ${row.texture}`);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: row.fog, toneMapped: row.toneMapped }));
      owned.push(sprite.material); part = sprite;
      const material = sprite.material; // lent to the lane as a plain field (numeric ports refuse class instances)
      owners.set(`${row.id}Material`, { get opacity() { return material.opacity; }, set opacity(value: number) { material.opacity = value; } });
    } else {
      const g = loader.parse(file.shapes[row.shape]); owned.push(g);
      if (row.kind === 'instanced') {
        const matrices = table(row.matrices), mesh = new THREE.InstancedMesh(g, lentLook(row.look), Math.max(1, matrices.length / 16));
        mesh.count = matrices.length / 16; mesh.instanceMatrix.array.set(matrices); mesh.instanceMatrix.needsUpdate = true; part = mesh;
      } else part = row.kind === 'points' ? new THREE.Points(g, lentLook(row.look)) : new THREE.Mesh(g, lentLook(row.look));
    }
    part.frustumCulled = false; part.visible = false; part.renderOrder = row.order; part.name = row.id;
    meshes.set(row.id, part); group.add(part);
  }
  // the rain round the eye: streak quads posed and fogged by the rows' look graph
  const rainRow = rows.rain, phone = TIER === 'phone';
  const radius = rainRow === undefined ? 0 : phone ? rainRow.radius.phone : rainRow.radius.desktop, count = rainRow === undefined ? 0 : phone ? rainRow.streaks.phone : rainRow.streaks.desktop;
  const rain = rainRow === undefined ? null : new THREE.Mesh(rainCurtainGeometry(count, SEED, 'aSeed'), lentLook(rainRow.look));
  if (rain !== null && rainRow !== undefined) {
    setLentParam(rainRow.look, 'radius', radius); owned.push(rain.geometry);
    rain.frustumCulled = false; rain.renderOrder = rainRow.order; rain.visible = false; rain.name = 'rain'; meshes.set('rain', rain); group.add(rain);
  }
  const offset = new THREE.Vector3(), velocity = new THREE.Vector3(), rainV: [number, number, number] = [0, 0, 0];
  const rainU = { uVelx: 0, uVely: 0, uVelz: 0, uLen: 0, uAlpha: 0, uColx: 0, uColy: 0, uColz: 0 }, draw = { count: 0 }, airWind = { x: 0, z: 0 };
  const flags: Record<string, number> = Object.fromEntries([...meshes.keys()].map(id => [id, 0]));
  const params = graphParamRoots(channels, rows.lane, rows.params);
  for (const [id, part] of meshes) owners.set(id, part);
  for (const [id, root] of [...params.roots, ...sky.owners, ['wind', airWind], ['flags', flags], ['rainU', rainU], ['draw', draw], ['camera', game.camera.position]] as const) owners.set(id, root);
  game.levelScope.onDispose(() => { for (const item of owned) item.dispose(); });
  let lane: ReturnType<typeof installChannelPrograms> | null = null, reading: Record<string, number> | null = null;
  return { group,
    update(dt: number, weather: WeatherReading, storm: StormReading | null, idle: string | null, indoors: boolean): void {
      airWind.x = steppeWind.dirX * steppeWind.speed; airWind.z = steppeWind.dirZ * steppeWind.speed;
      if (lane === null || reading === null) {
        // the weather as one reading: its numbers, its registers and the reactions' flash (the lane reads `weather.*`)
        reading = { ...weather.n, ...weather.registers, flash: 0 }; owners.set('weather', reading);
        const events = storm === null ? [] : [...new Set(storm.rows.steps.flatMap(step => step.emit.map(row => row.event)))];
        for (const event of events) if (storm !== null && !owners.has(event)) owners.set(event, storm.record(event));
        lane = installChannelPrograms(channels, rows.lane, owners);
      }
      Object.assign(reading, weather.n, weather.registers); reading['flash'] = storm?.flash ?? 0;
      lane.evaluate({ time: 0, delta: dt, values: { active: Number(weather.state !== idle), count } }); pushLentParams(params);
      for (const [id, part] of meshes) part.visible = (flags[id] ?? 0) > 0;
      if (rain === null || rainRow === undefined) return;
      rain.visible &&= !indoors;
      velocity.set(rainU.uVelx, rainU.uVely, rainU.uVelz);
      if (!rain.visible) return;
      const box = radius * 2; offset.addScaledVector(velocity, dt);
      for (const axis of ['x', 'y', 'z'] as const) offset[axis] = ((offset[axis] % box) + box) % box;
      rain.geometry.setDrawRange(0, Math.ceil(draw.count) * 6);
      setLentParam(rainRow.look, 'offset', offset.toArray(rainV)); setLentParam(rainRow.look, 'velocity', velocity.toArray(rainV));
      rainV[0] = rainU.uColx; rainV[1] = rainU.uColy; rainV[2] = rainU.uColz; setLentParam(rainRow.look, 'colour', rainV);
      setLentParam(rainRow.look, 'length', rainU.uLen); setLentParam(rainRow.look, 'alpha', rainU.uAlpha);
    },
  };
}
