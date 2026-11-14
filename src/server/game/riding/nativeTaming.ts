import { Vector3 } from 'three';
import * as v from 'valibot';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { HerdBrain } from '@wildshard/engine/ai/herd';
import { pickPrompt, setPromptSight } from '@wildshard/engine/world/interact/prompts';
import { nativeHerdCollection } from '../shardfile/groupRuntime';
import { bondedMountRoster } from './roster';
import { mountedPlayerOf, type NativeMountedPlayer } from './native';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { TamingSession,type TamingPrograms } from '../../../shared/game/riding/taming';
import { RIDING_ACT, RIDING_ROW, type TamingBindingProfile, type TamingObservation } from '../../../shared/game/riding/bindingTypes';
import { createNativeCreaturePoses, type NativeCreaturePoseRecipe } from '../../../shared/game/plugin/animation';
import { numericCreaturePose } from '../../../shared/game/plugin/channelPrograms';
import { poseRidingEnvelopes, type RidingPresentationRows } from '../../../shared/game/riding/presentation';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { advanceCompanionCall } from '../../../shared/game/riding/companions';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

/** A riding row's owned name, made once per key (MMO-PLAN MP1.2: every client's owned rows joined these every tick). */
const ridingRows = new Map<string, string>();
function ridingRow(key: string): string {
  let name = ridingRows.get(key);
  if (name === undefined) { name = `${RIDING_ROW}${key}`; if (ridingRows.size < 4096) ridingRows.set(key, name); }
  return name;
}
/** Engine-owned tick input, shared by native modes; authors supply only rows. */
export interface NativeTamingContext {
  commands: () => readonly ({ kind: 'player'; steer?: { keyX: number } | undefined; seq?: number | undefined; pitch?: number | undefined } | { kind: 'script'; actorId: string; value: number } | { kind: 'action' })[];
}
export interface NativeTamingRows {
  step: string; herds: string; roster: string; kinds: readonly string[]; programs: TamingPrograms; binding: TamingBindingProfile;
  poses: readonly { kind: string; variant: string; pose: NativeCreaturePoseRecipe }[];
  presentation: RidingPresentationRows; poseProgram: unknown;
  inputs: { offer: string; lean: string; pitch: string; mount: string };
  rest: { x: number; z: number; face: { x: number; z: number } }; rail: { x: number; z: number };
  eye: number; impactRange: number; scareRange: number; scareSeconds: number; thrownLabel: string;
}
/** Native observations and actions expose no per-shard hooks or callback ports. */
/** One player's taming controls this tick. */
export interface NativeTamingPress { readonly offer?: boolean; readonly lean?: number; readonly pitch?: number; readonly mount?: boolean }
/** J108: every player tames for themselves. Their session starts when they first offer or ask to mount; a horse they tame
 * leaves the wild pool and becomes their own mount, seen by everyone, and in a room a new wild one comes later. */
export interface NativeTamingControls {
  /** Any player's controls for the next tick; the tick tape speaks for the first player. */
  readonly press: (id: string, press: NativeTamingPress) => void;
  /** A player's own session, once they have one. */
  readonly sessionOf: (id: string) => NativeTamingOwner | undefined;
}
export interface NativeTamingOwner {
  readonly scope: SimHost['scope'];
  readonly phase: 'wild' | 'breaking' | 'bonded'; readonly companion: AnimalSim | null; readonly upgraded: boolean;
  readonly promptHorse: AnimalSim | null; readonly view: TamingObservation;
  readonly interactable: { position: Vector3; radius: number; label: string; onInteract: () => void };
  update: (dt: number) => void; forceBreak: () => void; snapshot: () => string; noteEvent: (name: string, x: number, z: number) => void;
  noteShot: (x: number, z: number) => void;
}
const finite = v.pipe(v.number(), v.finite());
const SessionRows = { law: v.string(), bond: v.nullable(v.string()),
  calling: v.exactOptional(v.pipe(finite, v.minValue(0), v.maxValue(30))),
  pitch: v.pipe(finite, v.minValue(-Math.PI / 2), v.maxValue(Math.PI / 2)), shake: finite, roll: finite };
const SessionSaved = v.strictObject(SessionRows);
const Saved = v.strictObject({ version: v.literal(1), ...SessionRows,
  poses: v.pipe(v.array(v.tuple([v.string(), v.string()])), v.maxLength(64)),
  others: v.exactOptional(v.record(v.string(), SessionSaved)),
  // retired: wild returns moved to the population's refill row, which queues a saved hidden stallion again on load
  wild: v.exactOptional(v.record(v.string(), finite)) });
/** One player's session over the world's herds and poses. */
interface TamingSeat {
  readonly player: PlayerSim; readonly law: TamingSession<AnimalSim, HerdBrain<AnimalSim>>;
  /** One frame: `read` says the tick tape speaks for this player. */
  readonly tick: (dt: number, read: boolean) => void;
  readonly shake: number; readonly roll: number;
  readonly holdOffer: (held: boolean) => void; readonly whistle: () => void;
  /** SC5 (J328): its player left the room: the bodies it bonded go too, or a grid cell that never starts over gathers them past 64. */
  readonly release: () => void;
  readonly save: () => { [Key in keyof v.InferOutput<typeof SessionSaved>]: v.InferOutput<typeof SessionSaved>[Key] };
  readonly load: (saved: v.InferOutput<typeof SessionSaved>, horses: readonly AnimalSim[]) => void;
}
const installed = new WeakMap<SimHost, NativeTamingOwner>(), controls = new WeakMap<SimHost, NativeTamingControls>();
/** Read only this host's live taming law; no global ride singleton or reward override. */
export function nativeTamingOf(host: SimHost): NativeTamingOwner | undefined { return installed.get(host); }
/** Read this host's taming controls. */
export function nativeTamingControls(host: SimHost): NativeTamingControls | undefined { return controls.get(host); }

/** Install native's actual approach/bucking/adoption law after its dynamic roster and native mounted owner.
 * Tick inputs: script riding.taming.offer=0|1, riding.taming.lean=-1..1, riding.look.pitch=-pi/2..pi/2,
 * riding.taming.mount=1. Mount answers the live native prompt with actual reach and WORLD/body sight.
 * The creature manager calls update after Wildlife, BEFORE raid and think. Only this law's owned clocks are saved here.
 */
export function installNativeTaming(host: SimHost, context: NativeTamingContext, rows: NativeTamingRows): NativeTamingOwner {
  const { herds, wind } = nativeHerdCollection(host, rows.herds), creatures = bondedMountRoster(host, rows.roster), firstSeat = mountedPlayerOf(host);
  if (firstSeat === undefined) throw new Error('Missing native mounted owner');
  const sessions = new Map<string, TamingSeat>(), pending = new Map<string, NativeTamingPress>();
  const draw = numericCreaturePose(rows.poseProgram);
  if (installed.has(host)) throw new Error('native taming already installed');
  const poses = createNativeCreaturePoses(rows.poses, 64), poseRows: AnimalSim[] = [];
  const addPose = (a: AnimalSim): void => {
    if (poseRows.length >= 64 || poses.get(a.entityId) !== undefined || !rows.kinds.includes(a.kind)) throw new Error('Invalid native taming pose roster');
    poses.binding.preflight(a); poses.binding.attach(a, { id: a.entityId, kind: a.kind, variant: a.variant });
    const pose = poses.get(a.entityId); if (pose === undefined) throw new Error('Missing taming pose'); pose.publish(); poseRows.push(a);
    a.headWorld = out => { pose.headWorld(out); return out; };
    // Manager samples pose terrain before its own decision, never at a second independent clock.
    const managed = creatures.actors.find(body => body === a); if (managed === undefined) throw new Error('Foreign native taming body');
    managed.sampleTerrain = () => { pose.sampleTerrain(); };
  };
  if (creatures.actors.length > 64) throw new Error('native taming body bound exceeded');
  for (let i = 0; i < 64; i++) { const a = creatures.actors[i]; if (a === undefined) break; if (rows.kinds.includes(a.kind)) addPose(a); }
  const invalidInput = new Error('Invalid native taming input');
  const sessionFor = (player: PlayerSim): TamingSeat => {
  const known = sessions.get(player.id); if (known?.player === player) return known;
  const mounted = mountedPlayerOf(host, player.id); if (mounted === undefined) throw new Error('Missing native mounted owner');
  let bond: string | null = null, pitch = 0, offer = false, heldOffer = false, calling = 0, lean = 0, shake = 0, roll = 0;
  const camera = new Vector3(), eye = new Vector3(), hurtDir = new Vector3(), mine = new Set<string>();
  const retireBonded = (a: AnimalSim): void => {
    mine.delete(a.entityId); creatures.retire(a.entityId); poses.delete(a.entityId);
    const at = poseRows.indexOf(a); if (at === -1) throw new Error('Missing bonded pose'); poseRows.splice(at, 1);
  };
  const law = new TamingSession<AnimalSim, HerdBrain<AnimalSim>>({
    profile: rows.binding,
    programs: rows.programs,
    bond: { read: () => null, write: value => { if (!rows.binding.bonds.includes(value)) throw new Error('Invalid native bond'); bond = value; actRoutes(host).bonded?.(player.id, value); } },
    player: { get position() { return player.position; }, get crouching() { return mounted.rider.crouching; },
      get yaw() { return player.yaw; }, set yaw(value) { player.yaw = value; }, get pitch() { return pitch; }, set pitch(value) { pitch = value; },
      keys: new Set<string>(), camera: { position: camera, getWorldDirection: out => out.set(-Math.sin(player.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(player.yaw) * Math.cos(pitch)) } },
    mount: { get mounted() { return mounted.mounted; }, get horse() { return mounted.horse; },
      get breakShake() { return shake; }, set breakShake(value) { shake = value; }, get breakRoll() { return roll; }, set breakRoll(value) { roll = value; },
      mount: (a, breaking) => mounted.mount(a.entityId, breaking), dismount: thrown => { mounted.dismount(thrown); },
      addMountable: a => { mounted.addMountable(a.entityId); }, removeMountable: a => { mounted.removeMountable(a.entityId); } },
    hud: { get offer() { return offer; }, get lean() { return lean; } }, herds: () => herds, rest: rows.rest,
    wind: () => wind, random: () => host.rng.stream('ai').next(),
    spawnBonded: (x, z, yaw, upgraded) => { const a = creatures.spawn(x, z, yaw, upgraded, mine.size); mine.add(a.entityId); addPose(a); return a; },
    hideStallion: a => { creatures.hide(a.entityId); }, retireBonded: a => { retireBonded(a); }, hurt: amount => {
      host.combat.hit({ source: 'env', sourceTags: ['env.ride'], target: player.health, amount, throughWalls: true,
        point: player.position, dir: hurtDir, cause: { kind: 'env.ride', label: rows.thrownLabel, text: rows.thrownLabel } });
    },
  },host.scope);
  const candidates = [law.interactable], namePoint = new Vector3();
  // ride.ts chooses among registered mounts, taming, then the nearest rail NAME action, before main's LOS selector.
  // Companion rest/bolt and the global quest prompt list remain separate requirements.
  const selectedTaming = (): boolean => {
    if (mounted.mountables.length > 64) throw new Error('native mountable prompt bound exceeded');
    let best = Infinity, taming = false, naming: AnimalSim | null = null, nameDistance = Infinity;
    for (let i = 0; i < 64; i++) {
      const a = mounted.mountables[i]; if (a === undefined) break;
      const d = a.position.distanceTo(camera), radius = mounted.horse === a ? 3.6 : 3.3;
      if (d < radius && d < best) { best = d; taming = false; }
      if (!mounted.mounted && a.alive && Math.hypot(a.position.x - rows.rail.x, a.position.z - rows.rail.z) <= 5) {
        const foot = Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z);
        if (foot < nameDistance) { nameDistance = foot; naming = a; }
      }
    }
    const distance = law.interactable.position.distanceTo(camera);
    if (distance < law.interactable.radius && distance < best) { best = distance; taming = true; }
    if (naming !== null) {
      const x = naming.position.x + Math.sin(naming.yaw) * 1.15 * naming.scale, z = naming.position.z + Math.cos(naming.yaw) * 1.15 * naming.scale;
      namePoint.set(x, host.groundHeightAt(x, z) + 1.5, z);
      const d = namePoint.distanceTo(camera); if (d < 1.9 && d < best) taming = false;
    }
    return taming;
  };
  const originalUpdate = law.update.bind(law);
  const session: TamingSeat = { player, law, get shake() { return shake; }, get roll() { return roll; }, holdOffer: held => { heldOffer = held; },
    release: () => { for (const id of mine) { const a = poseRows.find(row => row.entityId === id); if (a === undefined) mine.delete(id); else retireBonded(a); } }, whistle: () => {
    const horse = law.companion;
    if (!mounted.mounted && horse !== null && horse.mem['whistle'] === 1 && mounted.canRide(horse.entityId) && horse.position.distanceTo(player.position) < 150) calling = 30;
  }, tick: (dt, read) => {
    offer = heldOffer; lean = 0; let mount = false;
    if (read) {
      const commands = context.commands(); if (commands.length > 4096) throw invalidInput;
      for (let i = 0; i < 4096; i++) {
        const c = commands[i]; if (c === undefined) break;
        if (c.kind === 'player') { lean = c.steer?.keyX ?? 0; if (c.seq !== undefined && c.pitch !== undefined) pitch = c.pitch; } // a wire's command carries the rider's look; a tape's script row does
        else if (c.kind === 'script') {
          if (c.actorId === rows.inputs.offer) { if (c.value !== 0 && c.value !== 1) throw invalidInput; offer = c.value === 1; }
          else if (c.actorId === rows.inputs.lean) { if (!Number.isFinite(c.value) || Math.abs(c.value) > 1) throw invalidInput; lean = c.value; }
          else if (c.actorId === rows.inputs.pitch) { if (!Number.isFinite(c.value) || Math.abs(c.value) > Math.PI / 2) throw invalidInput; pitch = c.value; }
          else if (c.actorId === rows.inputs.mount) { if (c.value !== 1) throw invalidInput; mount = true; }
        }
      }
    }
    const press = pending.get(player.id);
    if (press !== undefined) { offer = press.offer ?? offer; lean = press.lean ?? lean; pitch = press.pitch ?? pitch; mount = press.mount ?? mount; }
    camera.copy(player.position); camera.y += rows.eye;
    originalUpdate(dt);
    const companion = law.companion;
    if (calling > 0) {
      if (companion === null || !companion.alive || mounted.mounted) calling = 0;
      else { calling = Math.max(0, calling - dt); if (advanceCompanionCall(companion, player.position, mounted.speeds)) calling = 0; }
    }
    if (mount && selectedTaming()) {
      setPromptSight(law.interactable, { body: law.promptHorse, slack: 0.5 });
      eye.copy(camera);
      if (pickPrompt(candidates, eye, host.physics) === law.interactable) law.startBreaking();
    }
  }, save: () => ({ law: law.snapshot(), bond, pitch, shake, roll, ...(calling > 0 ? { calling } : {}) }), load: (saved, horses) => {
    law.restore(saved.law, horses);
    calling = saved.calling ?? 0; heldOffer = false;
    bond = saved.bond; pitch = saved.pitch; shake = saved.shake; roll = saved.roll;
    mine.clear(); if (law.bonded !== null) { mine.add(law.bonded); mounted.claim(law.bonded); }
  } };
  sessions.set(player.id, session); return session;
  };
  const first = sessionFor(firstSeat.player), { law } = first;
  const others = (): TamingSeat[] => [...sessions.values()].filter(session => session !== first);
  host.events.on('creature.signal', ({ name, x, z }) => { for (const session of sessions.values()) session.law.noteEvent(name, x, z); }, host.scope);
  host.events.on('weapon.impact', ({ point }) => {
    // Same state.ts filter: only a distant landing, not an arm's-length melee impact.
    const near = host.nearestPlayer(point).position;
    if (Math.hypot(point.x - near.x, point.z - near.z) < rows.impactRange) return;
    for (let i = 0; i < 8; i++) { const h = herds[i]; if (h === undefined) break; h.disturb(point.x, point.z); }
    for (let i = 0; i < 16; i++) { const f = creatures.flocks[i]; if (f === undefined) break; if (Math.hypot(f.cx - point.x, f.cz - point.z) < rows.scareRange) f.scare(point.x, point.z, rows.scareSeconds); }
    for (const session of sessions.values()) session.law.noteShot(point.x, point.z);
  }, host.scope);
  const closestToWild = (): TamingSeat | null => {
    let best: TamingSeat | null = null, nearest = Infinity;
    for (const session of sessions.values()) {
      if (session.law.phase !== 'wild') continue;
      for (const herd of herds) {
        const stallion = herd.stallion; if (stallion === null) continue;
        const distance = stallion.position.distanceToSquared(session.player.position);
        if (distance < nearest) { nearest = distance; best = session; }
      }
    }
    return best;
  };
  law.update = dt => {
    for (const [id, session] of sessions) if (host.players.get(id) !== session.player) { session.release(); sessions.delete(id); }
    // Trust is the herd's: one voice speaks to it, the wild session closest to a stallion, or a far player would talk it down.
    const heard = sessions.size < 2 ? null : closestToWild();
    if (heard === null || first.law.phase !== 'wild' || heard === first) first.tick(dt, true);
    for (const session of others()) if (session.law.phase !== 'wild' || heard === session) session.tick(dt, false);
    for (const [id, press] of pending) {
      const player = host.players.get(id);
      if (player !== undefined && !sessions.has(id) && (press.offer === true || press.mount === true)) sessionFor(player).tick(dt, false);
    }
    pending.clear();
  };
  const missingPose = new Error('Missing native taming pose');
  host.onStep(rows.step, () => {
    for (let i = 0; i < 64; i++) {
      const row = poseRows[i]; if (row === undefined) break;
      const pose = poses.get(row.entityId); if (pose === undefined) throw missingPose;
      const bodyDt = host.bodyDt(row.entityId); if (bodyDt <= 0) continue;
      const near = row.position.distanceToSquared(host.nearestPlayer(row.position).position) < 140 * 140;
      pose.advance(bodyDt, host.clock.now, near); if (near) { poseRidingEnvelopes(pose.context, rows.presentation, wind); draw(pose.context); } pose.publish();
    }
  }, {
    snapshot: (): SimValue => {
      const rest = others();
      return { version: 1, ...first.save(), poses: poseRows.map(actor => { const pose = poses.get(actor.entityId); if (pose === undefined) throw missingPose; return [actor.entityId, pose.snapshot('local')]; }),
        ...(rest.length === 0 ? {} : { others: Object.fromEntries(rest.map(session => [session.player.id, session.save()])) }) };
    },
    restore: value => {
      const saved = v.parse(Saved, value);
      if (saved.poses.length !== poseRows.length || new Set(saved.poses.map(([id]) => id)).size !== poseRows.length) throw new Error('Invalid native taming pose identities');
      for (let i = 0; i < 64; i++) { const row = saved.poses[i]; if (row === undefined) break; const [id, wire] = row; const pose = poses.get(id); if (pose === undefined) throw missingPose; pose.restore(wire); }
      const horses = creatures.actors.filter(a => rows.kinds.includes(a.kind));
      first.load(saved, horses);
      for (const [id, row] of Object.entries(saved.others ?? {})) {
        const player = host.players.get(id); if (player === undefined) throw new Error('Unknown native tamer');
        sessionFor(player).load(row, horses);
      }
    },
  }, 'afterBodies');
  host.scope.onDispose(() => { for (let i = 0; i < 64; i++) { const actor = poseRows[i]; if (actor === undefined) break; poses.delete(actor.entityId); } poseRows.length = 0; installed.delete(host); });
  controls.set(host, { sessionOf: id => sessions.get(id)?.law, press: (id, press) => {
    if (!host.players.has(id)) throw new RangeError(`Unknown taming player ${id}`);
    pending.set(id, { ...pending.get(id), ...press });
  } });
  const net = actRoutes(host);
  const seatFor = (id: string): TamingSeat | undefined => { const player = host.players.get(id); return player === undefined ? undefined : sessionFor(player); };
  net.claims.set(RIDING_ACT.offer, id => { seatFor(id)?.holdOffer(true); });
  net.claims.set(RIDING_ACT.release, id => { seatFor(id)?.holdOffer(false); });
  net.claims.set(RIDING_ACT.whistle, id => { seatFor(id)?.whistle(); });
  publishOwned(host, rows.step, (id, out) => {
    const seat = sessions.get(id); if (seat === undefined) return;
    const { law: owner } = seat, { view, interactable } = owner;
    const put = (key: string, value: number): void => { out.set(ridingRow(key), value); };
    put('phase', ['wild', 'breaking', 'bonded'].indexOf(owner.phase) + 1);
    put('trust', view.trust === null ? 0 : view.trust + 1); put('alert', view.alert); put('round', view.round ?? 0);
    put('balance', view.balance); put('danger', Number(view.danger)); put('offer', Number(view.offer));
    put('beaten', Number(interactable.label === rows.binding.labels.breaking)); put('radius', interactable.radius); put('upgraded', Number(owner.upgraded));
    put('shake', seat.shake); put('roll', seat.roll);
    for (const [key, point] of [['prompt', interactable.position], ['ear', view.ear]] as const) {
      put(`${key}.on`, Number(point !== null));
      if (point !== null) { put(`${key}.x`, point.x); put(`${key}.y`, point.y); put(`${key}.z`, point.z); }
    }
    if (owner.promptHorse !== null) put(`stallion:${owner.promptHorse.entityId}`, 1);
    if (owner.companion !== null && owner.companion.alive) put(`companion:${owner.companion.entityId}`, Number(owner.companion.mem['whistle'] === 1));
  });
  net.ride = (id, action) => {
    const seat = mountedPlayerOf(host, id);
    if (action === 'dismount') { seat?.dismount(); return; }
    // the page's prompt, on the server's numbers: the nearest horse in reach that will take this rider, or the wild one's press
    if (action === 'mount' && seat !== undefined && !seat.mounted && mountNearest(seat, rows.eye)) return;
    pending.set(id, { ...pending.get(id), [action]: true });
  };
  net.mountable = id => { for (const player of host.players.keys()) if (mountedPlayerOf(host, player)?.mountables.some(horse => horse.entityId === id) === true) return true; return false; };
  net.lean = (id, lean, pitch) => { if (seatFor(id) !== undefined) pending.set(id, { ...pending.get(id), lean, pitch }); };
  installed.set(host, law); return law;
}

/** m from the eye a horse answers a press: the page's `Mount` prompt. */
const MOUNT_REACH = 3.3;
/** Get on the nearest horse in reach that takes this rider. False: none did. */
function mountNearest(seat: NativeMountedPlayer, eyeHeight: number): boolean {
  const { x, y, z } = seat.player.position;
  let best: string | null = null, bestDistance = MOUNT_REACH;
  for (const horse of seat.mountables) {
    const distance = Math.hypot(horse.position.x - x, horse.position.y - y - eyeHeight, horse.position.z - z);
    if (distance < bestDistance && seat.canRide(horse.entityId)) { best = horse.entityId; bestDistance = distance; }
  }
  return best !== null && seat.mount(best);
}

/** The page's respawnPageMounted for a native host: the player stands at `position` facing `yaw`, at rest, and rides the
 *  first horse the ride rules take (the bonded companion first, then the mountables in their order), placed and turned
 *  `row.yaw` from the player, its stamina set to `row.steed`. On foot when none can be ridden. */
export function respawnNativeMounted(host: SimHost, position: Vector3, yaw: number, row: { readonly yaw: number; readonly steed: number }, id?: string): void {
  const mounted = mountedPlayerOf(host, id);
  if (mounted === undefined) throw new Error('Missing native mounted owner');
  const { player } = mounted;
  if (mounted.mounted) mounted.dismount();
  player.position.copy(position); player.motor.resetAt(position); player.yaw = yaw;
  mounted.rider.velocity.set(0, 0, 0); player.velocity.set(0, 0, 0);
  const companion = controls.get(host)?.sessionOf(player.id)?.companion ?? null;
  for (const actor of [...(companion === null ? [] : [companion]), ...mounted.mountables]) {
    if (!mounted.canRide(actor.entityId)) continue;
    actor.place(position.x, position.z, yaw + row.yaw);
    if (mounted.mount(actor.entityId)) {
      mounted.teleport(position.x, position.z, yaw + row.yaw); mounted.body.steed = row.steed; mounted.body.winded = false; return;
    }
  }
}
