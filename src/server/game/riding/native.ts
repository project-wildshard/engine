import { ReturnProgram } from '@wildshard/engine/game/population/returnProgram';
import { NativeRidingSchema } from '@wildshard/format/nativeRiding';
import { nativeHerdCollection } from '../shardfile/groupRuntime';
import { readScalarLattice } from '@wildshard/engine/world/scalarChannel';
import { commandReins, MountedBody, mountedMotorOptions, RIDE_WORDS, type MountedRider, type MountedWorld, type ReinsFrameRow } from '@wildshard/engine/game/riding/physics';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { SimHost, SimPlayerDriver, SimPlayerMotionSample, SimRide, SimValue } from '@wildshard/engine/sim';
import { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { AnimalPoseLaw } from '@wildshard/engine/entities/animalPose';
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { tagOf } from '@wildshard/engine/physics/surface';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

type MountedWorldSpeeds = ConstructorParameters<typeof MountedBody>[0];

const num = v.pipe(v.number(), v.finite()), triple = v.tuple([num, num, num]);
const handle = v.nullable(v.pipe(num, v.minValue(0)));
const MotorState = v.strictObject({ version: v.literal(1), colliderHandle: v.pipe(num, v.minValue(0)),
  filter: v.pipe(num, v.integer(), v.minValue(0), v.maxValue(0xffffffff)), ghost: v.string(), enabled: v.boolean(), yaw: num,
  anchor: v.strictObject({ x: num, y: num, z: num }), anchorBodyHandle: handle,
  climbAngle: num, slideAngle: num, result: v.strictObject({ grounded: v.boolean(), groundNormalY: num,
    downhillX: num, downhillZ: num, horizontalFreedom: num, groundColliderHandle: handle }) });
const SeatRows = { horse: v.nullable(v.string()), body: v.unknown(), motor: v.nullable(MotorState),
  decisionClock: num, walkingSpeed: v.optional(num), rider: v.strictObject({ velocity: triple, onGround: v.boolean(), sprinting: v.boolean(), crouching: v.boolean(), speedFactor: num }) };
const SeatSaved = v.strictObject(SeatRows);
const Saved = v.strictObject({ version: v.literal(1), ...SeatRows, poses: v.pipe(v.array(v.tuple([v.string(), v.string()])), v.maxLength(64)),
  others: v.exactOptional(v.record(v.string(), SeatSaved)) });

/** Trusted physical rider, not a presentation/taming stand-in. Mountable identities come from the page's actual camp roster. */
export interface NativeMountedPlayer {
  readonly player: PlayerSim;
  readonly body: MountedBody; readonly rider: MountedRider;
  /** Admitted gait speeds for authoritative companion calls. */
  readonly speeds: MountedWorldSpeeds;
  readonly mounted: boolean; readonly horse: AnimalSim | null;
  readonly mount: (id: string, breaking?: boolean) => boolean;
  /** J108: this horse is this player's own; nobody else may ride it. */
  readonly claim: (id: string) => void;
  /** Only the taming owner may register/retire an actually adopted horse. */
  readonly addMountable: (id: string) => void; readonly removeMountable: (id: string) => void; readonly dismount: (thrown?: boolean) => void;
  /** Actual registration order, for the page's strict nearest ride-action selector. */
  readonly mountables: readonly AnimalSim[];
  readonly phase: (id: string) => number;
  /** Whether the ride rules would take this horse now (the page Mount's canRide; native horses have no rest or bolt). */
  readonly canRide: (id: string) => boolean;
  /** The page Mount's teleport: the ridden horse and its rider stand at x, z facing yaw, at rest. */
  readonly teleport: (x: number, z: number, yaw: number) => void;
}
/** One player's saddle under the host's riding law: what the law steps and saves for them. */
interface Seat extends NativeMountedPlayer {
  /** The on-foot observation the law keeps while no horse is under them. */
  readonly observe: (dt: number) => void;
  readonly save: () => Record<string, SimValue>;
  /** Refuse a foreign save before anything changes. */
  readonly check: (state: v.InferOutput<typeof SeatSaved>) => void;
  readonly load: (state: v.InferOutput<typeof SeatSaved>) => void;
  readonly reconnect: () => void;
  /** The player has gone: their horse walks free, and nothing touches their body. */
  readonly leave: () => void;
}
const installed = new WeakMap<SimHost, { readonly first: NativeMountedPlayer; readonly seat: (id: string) => NativeMountedPlayer | undefined }>();
/** Read this host's owned riding law; no page/global singleton. Without `id`, the first player's seat. */
export function mountedPlayerOf(host: SimHost, id?: string): NativeMountedPlayer | undefined {
  const law = installed.get(host);
  return id === undefined ? law?.first : law?.seat(id);
}

/** The page's native reins/body and gait phase under the host's single physics authority, one seat a player: each rides
 * their own horse on their own reins, and the roster, the poses and the rules are the world's. The ordinary player driver
 * remains authoritative on foot. Companions, taming and the weapons are subsequent installs, never simulated here. One
 * player saves the one seat's exact bytes; a seat comes when a player first plays a tick, or is first asked for. */
export function installMountedPlayer(host: SimHost, profile: unknown, pondBlock?: { readonly file: string; readonly bytes: Uint8Array }, wetBlock?: { readonly file: string; readonly bytes: Uint8Array }): NativeMountedPlayer {
  const rows = v.parse(NativeRidingSchema, profile), { herds } = nativeHerdCollection(host, rows.herds);
  const blocks = new Map(pondBlock === undefined ? [] : [[pondBlock.file,pondBlock.bytes]]);
  if(wetBlock!==undefined){if(blocks.has(wetBlock.file))throw new Error('Duplicate native scalar block');blocks.set(wetBlock.file,wetBlock.bytes);}
  const mask = (data: typeof rows.world.pond): ((x: number,z: number) => number) => readScalarLattice({ res: rows.world.res,size: rows.world.size,values: typeof data === 'string' ? { type: 'f32',count: rows.world.res*rows.world.res,data } : data },blocks);
  const wet = mask(rows.world.wet), pond = mask(rows.world.pond);
  const heightAt = (x: number, z: number): number => host.groundHeightAt(x, z);
  const waterLevel = (): number => rows.world.water;
  const surfaceAt = (x: number, z: number): number | null => pond(x, z) > 0 ? rows.world.water : null;
  const wetAt = (x: number, z: number): boolean => wet(x, z) > .5;
  const inBounds = (x: number, z: number, margin: number): boolean => Math.abs(x) < rows.world.size / 2 - margin && Math.abs(z) < rows.world.size / 2 - margin;
  if (installed.has(host)) throw new Error('Native mounted player already installed');
  const rules = ReturnProgram.native(host, rows.program);
  const poses = new Map<string, AnimalPoseLaw>();
  const horses = [...host.entities.values()].filter(actor => rows.kinds.includes(actor.kind));
  if (horses.length > 64 || herds.length > 64) throw new Error('Native mounted roster exceeds its bound');
  for (let i = 0; i < Math.min(64, horses.length); i++) {
    const actor = horses[i]; if (actor === undefined) throw new Error('Missing mounted roster actor');
    poses.set(actor.entityId, new AnimalPoseLaw({ dims: actor.dims, custom: true,
      ...rows.pose }));
  }
  const byHerd = new Map<AnimalSim, (typeof herds)[number]>();
  for (let i = 0; i < Math.min(64, herds.length); i++) {
    const h = herds[i]; if (h === undefined || h.members.length > 256) throw new Error('Invalid mounted herd');
    for (let j = 0; j < Math.min(256, h.members.length); j++) {
      const a = h.members[j]; if (a === undefined) throw new Error('Missing mounted herd member'); byHerd.set(a, h);
    }
  }
  const herd = (a: AnimalSim) => byHerd.get(a) ?? null;
  const phase = (id: string): number => { const pose = poses.get(id); if (pose === undefined) throw new Error('Missing mounted horse phase'); return pose.phase; };
  const available = new Set(rows.mountable);
  if (rows.mountable.length > 64 || available.size !== rows.mountable.length) throw new Error('Invalid Native mountable roster');
  for (let i = 0; i < Math.min(64, rows.mountable.length); i++) {
    const id = rows.mountable[i]; if (id === undefined || !poses.has(id)) throw new Error('Invalid Native mountable identity');
  }
  const mountables = rows.mountable.map(id => { const a = host.entities.get(id); if (a === undefined) throw new Error('Missing native mountable'); return a; });
  const poseRows = [...poses].map(([id, pose]) => ({ id, pose }));
  const seats = new Map<string, Seat>(), owners = new Map<string, string>();
  /** The herd's one `ridden` slot, kept on a horse someone still rides when another of its herd is mounted or let go. */
  const holdHerd = (a: AnimalSim): void => {
    const h = herd(a); if (h === null) { a.mem['ridden'] = 1; return; }
    h.setRidden(a);
    for (const seat of seats.values()) if (seat.horse !== null && seat.horse !== a && herd(seat.horse) === h) seat.horse.mem['ridden'] = 1;
  };
  const releaseHerd = (a: AnimalSim): void => {
    const h = herd(a);
    if (h?.ridden !== a) { a.mem['ridden'] = 0; return; }
    h.setRidden(null);
    for (const seat of seats.values()) if (seat.horse !== null && seat.horse !== a && herd(seat.horse) === h) { h.setRidden(seat.horse); return; }
  };
  const addMountable = (id: string): void => {
    const a = host.entities.get(id); if (a === undefined) throw new Error('Missing adopted mount');
    if (host.entities.get(a.entityId) !== a || a.kind !== rows.adopted.kind || a.variant !== rows.adopted.variant || available.has(a.entityId)
      || poses.size >= 64) throw new Error('Foreign Native adopted mount');
    const pose = new AnimalPoseLaw({ dims: a.dims, custom: true,
      ...rows.pose });
    a.mem['owned'] = 1; poses.set(a.entityId, pose); poseRows.push({ id: a.entityId, pose }); available.add(a.entityId); mountables.push(a);
  };
  const removeMountable = (id: string): void => {
    const a = host.entities.get(id); if (a === undefined) throw new Error('Missing adopted mount');
    if (host.entities.get(a.entityId) !== a || [...seats.values()].some(seat => seat.horse === a) || a.kind !== rows.adopted.kind || a.variant !== rows.adopted.variant
      || !available.delete(a.entityId)) throw new Error('Foreign Native mount removal');
    const registered = mountables.indexOf(a); if (registered === -1) throw new Error('Missing adopted mount'); mountables.splice(registered, 1);
    poses.delete(a.entityId); const at = poseRows.findIndex(row => row.id === a.entityId); if (at === -1) throw new Error('Missing adopted pose');
    poseRows.splice(at, 1);
  };
  const missingPose = new Error('Missing mounted pose actor');
  const seatFor = (player: PlayerSim): Seat => {
  const known = seats.get(player.id); if (known?.player === player) return known;
  player.modes.register({ id: 'ride', hud: 'ride' }, host.scope);
  const body = new MountedBody(rows.speeds), rider: MountedRider = { position: player.position, velocity: new Vector3(),
    onGround: true, sprinting: false, crouching: false, speedFactor: 1 };
  let decisionClock = 0;
  const previousFoot = player.position.clone();
  let horse: AnimalSim | null = null, savedMotor: v.InferOutput<typeof MotorState> | null = null;
  /** The horse under them walks free where it stands. */
  const freeHorse = (a: AnimalSim): void => {
    a.position.copy(body.feet); a.yaw = body.heading; a.driven = false; a.levelGround = false;
    a.yOffset = Math.max(0, body.feet.y - heightAt(body.feet.x, body.feet.z));
    body.motor?.dispose(); body.motor = null;
  };
  const settleHorse = (a: AnimalSim): void => {
    releaseHerd(a);
    a.setMotion(a.yaw, 0, 2); a.mem['rear'] = 0; a.mem['buck'] = 0; a.mem['turnLead'] = 0;
    body.gait = 'stand';
  };
  const dismount = (thrown = false): void => {
    const a = horse; if (a === null) return;
    freeHorse(a);
    const site = rules.project('dismount', { x: a.position.x, z: a.position.z, yaw: a.yaw, thrown: Number(thrown) });
    let x = site['x'] ?? a.position.x, z = site['z'] ?? a.position.z;
    if (!inBounds(x, z, 3)) { x = site['altX'] ?? x; z = site['altZ'] ?? z; }
    rider.position.set(x, Math.max(heightAt(x, z), body.onDeck ? body.feet.y : -Infinity), z);
    rider.velocity.set(0, 0, 0); rider.onGround = true; rider.speedFactor = 1;
    player.motor.setEnabled(true); player.fall.grounded = true; player.velocity.y = 0;
    horse = null; body.breaking = false; player.modes.exit('ride');
    settleHorse(a);
  };
  const world: MountedWorld = { get physics() { return host.physics; }, heightAt, waterLevel,
    wetAt, stampede: owner => {
      if (!(owner instanceof AnimalSim) || owner === horse) return null;
      const h = herd(owner);
      return h !== null && (h.stampeding || (owner === h.stallion && h.stallionState === 'charge')) ? owner : null;
    }, thrown: () => {
      dismount(true);
      host.combat.hit({ source: 'env', sourceTags: [], target: player.health, amount: rows.thrownDamage, point: player.position,
        dir: rider.velocity, cause: { kind: 'env.ride', label: rows.thrownLabel, text: rows.thrownLabel } });
    } };
  const frame: ReinsFrameRow = {
    forward: 0, turn: 0, touchX: 0, touchY: 0, gallop: false, jump: false, drawing: false, moveScale: 1,
    phase: 0, feet: body.feet, roads: rows.roads, inBounds, refuses: () => false, wet: false };
  const motion = { velocityX: 0, velocityZ: 0, grounded: true, swimming: false, hover: false };
  const sampleMotion = (): SimPlayerMotionSample => {
    // MountedBody owns carrier velocity; neither corrected feet displacement nor the on-foot approximation supplies it.
    motion.velocityX = rider.velocity.x; motion.velocityZ = rider.velocity.z; motion.grounded = rider.onGround;
    return motion;
  };
  /** On foot the law only watches the walk: this owns no motion. */
  const onFoot: SimPlayerDriver = { input: (command, dt) => {
    previousFoot.copy(player.position);
    const versioned = command?.commandVersion === 1;
    const board = command?.hover === true ? !player.board.on : player.board.on;
    const surface = surfaceAt(rider.position.x, rider.position.z);
    const depth = surface === null ? 0 : Math.max(0, surface - rider.position.y);
    const forward = command === undefined ? 0 : -Math.sin(command.yaw) * command.moveX - Math.cos(command.yaw) * command.moveZ;
    decisionClock += dt;
    if (decisionClock + 1e-9 >= .1) {
      decisionClock = 0;
      const row = rules.project('walk', { version: Number(versioned), board: Number(board), swim: Number(player.swim.on), depth, forward, crouched: Number(command?.crouch === true), sprint: Number(command?.sprint === true), grounded: Number(player.fall.grounded) });
      rider.crouching = row['crouched'] === 1; rider.sprinting = row['sprinting'] === 1;
    }
    return false;
  }, step: () => undefined };
  /** In the saddle (P1-E5.3-D1): the step dispatches here, so a ride is a mode of the one motion step. */
  const ride: SimRide = { motionSample: sampleMotion, mount: () => horse?.entityId ?? '', capture: (out, at) => { body.captureRide(out, at); return RIDE_WORDS; }, read: (command, dt) => {
    if (horse?.alive === false) dismount(true);
    const a = horse;
    if (a === null) return;
    previousFoot.copy(player.position);
    if (command !== undefined && (command.commandVersion !== 1 || command.steer === undefined)) throw new Error('Mounted reins require versioned raw local controls');
    if (command !== undefined) player.yaw = command.yaw;
    player.impulse.set(0, 0, 0); rider.crouching = false;
    commandReins(frame, command); frame.phase = phase(a.entityId); frame.moveScale = player.moveScale;
    frame.wet = wetAt(body.feet.x, body.feet.z) || heightAt(body.feet.x, body.feet.z) < waterLevel() - 0.2;
    body.read(dt, frame); a.mem['turnLead'] = body.turnLead; a.lookWeight = 0;
  }, step: dt => {
    const a = horse; if (a === null) return;
    body.stepBody(dt, a, rider, world);
    if (horse !== null) body.placeRider(dt, 1, a, rider, world);
  } };
  player.useDriver(onFoot);
  const accepts = (id: string, breaking: boolean): boolean => {
    const a = host.entities.get(id);
    const allowed = rules.project('mount', { mounted: Number(horse !== null), present: Number(a !== undefined), alive: Number(a?.alive === true), driven: Number(a?.driven === true), available: Number(available.has(id) && (owners.get(id) ?? player.id) === player.id), breaking: Number(breaking), stallion: Number(herds.some(h => h.stallion === a)) });
    return allowed['accept'] === 1 && a !== undefined;
  };
  const mount = (id: string, breaking = false): boolean => {
    const a = host.entities.get(id);
    if (!accepts(id, breaking) || a === undefined) return false;
    player.setBoard(false); horse = a;
    holdHerd(a);
    a.setMotion(a.yaw, 0, 2); body.heading = a.yaw; body.speed = 0; body.wUp = 0; body.yawRate = 0;
    body.breaking = breaking;
    body.target = 0; body.rateIn = 0; body.turnIn = 0; body.sector = 2; body.jumpQueued = false;
    a.driven = true; a.yOffset = 0; body.feet.copy(a.position);
    body.jostles = 0; body.shoveX = body.shoveZ = 0; body.jolt = 0;
    body.cruise = 0; body.gallopWas = false; body.sectorWas = 2; body.skidT = 0; body.panicT = 0; body.panicRear = 0; body.onRoad = false;
    body.spur.reset(); body.spur.good = 0; body.lastPhase = phase(id);
    body.motor = withOwner(null, () => new CharacterMotor(host.physics, mountedMotorOptions(a.scale, a)));
    body.settleBody(); body.landBody(world); body.eyeY = body.feet.y;
    player.motor.setEnabled(false);
    player.modes.enter('ride', ride);
    return true;
  };
  const teleport = (x: number, z: number, yaw: number): void => {
    const a = horse; if (a === null) return;
    a.place(x, z, yaw); body.heading = yaw; body.speed = 0; a.speed = 0;
    body.feet.set(x, heightAt(x, z), z); body.settleBody(); body.landBody(world);
    body.eyeY = body.feet.y; player.yaw = yaw - Math.PI; body.yawRate = 0;
  };
  const seat: Seat = { player, body, rider, speeds: rows.speeds, get horse() { return horse; }, get mounted() { return horse !== null; }, mount, dismount, phase, mountables, claim: id => { owners.set(id, player.id); },
    addMountable: id => { addMountable(id); owners.set(id, player.id); }, removeMountable: id => { removeMountable(id); owners.delete(id); },
    canRide: id => accepts(id, false), teleport,
    observe: dt => {
      if (horse !== null) return;
      rider.velocity.set((rider.position.x - previousFoot.x) / dt, player.velocity.y, (rider.position.z - previousFoot.z) / dt);
      rider.onGround = player.fall.grounded;
    },
    save: () => {
      const state = body.snapshotBody(), motor = body.motor?.snapshot();
      return { decisionClock, horse: horse?.entityId ?? null, body: { ...state, reins: { ...state.reins, spur: { ...state.reins.spur } } },
        motor: motor === undefined ? null : { ...motor, anchor: { ...motor.anchor }, result: { ...motor.result } },
        rider: { velocity: rider.velocity.toArray(), onGround: rider.onGround, sprinting: rider.sprinting,
          crouching: rider.crouching, speedFactor: rider.speedFactor } };
    },
    check: state => {
      const checked = new MountedBody(rows.speeds); checked.restoreBody(state.body);
      const a = state.horse === null ? null : host.entities.get(state.horse);
      if (a === undefined || (state.horse === null) !== (state.motor === null) || (a !== null && ((!available.has(a.entityId) && !(checked.breaking && herds.some(h => h.stallion === a))) || !a.driven))) throw new Error('Invalid mounted continuation identity');
    },
    load: state => {
      const a = state.horse === null ? null : host.entities.get(state.horse) ?? null;
      body.restoreBody(state.body); decisionClock = state.decisionClock; horse = a; savedMotor = state.motor;
      rider.velocity.fromArray(state.rider.velocity); rider.onGround = state.rider.onGround; rider.sprinting = state.rider.sprinting;
      rider.crouching = state.rider.crouching; rider.speedFactor = state.rider.speedFactor;
      if (a === null) player.modes.exit('ride'); else player.modes.enter('ride', ride);
    },
    reconnect: () => {
      if (horse === null || savedMotor === null) return;
      const native = host.physics.world, state = savedMotor;
      if (!native.colliders.contains(state.colliderHandle)) throw new Error('Missing mounted native collider');
      const c = native.getCollider(state.colliderHandle), opts = mountedMotorOptions(horse.scale, horse);
      const half = (opts.length ?? 0) / 2 - opts.radius;
      if (tagOf(c)?.owner !== horse || c.shapeType() !== host.physics.R.ShapeType.Capsule
        || Math.abs(c.halfHeight() - half) > 1e-6 || Math.abs(c.radius() - opts.radius) > 1e-6) throw new Error('Invalid mounted native capsule identity');
      body.motor = withOwner(null, () => new CharacterMotor(host.physics, opts, state)); savedMotor = null;
    },
    leave: () => {
      const a = horse; if (a !== null) { freeHorse(a); horse = null; body.breaking = false; settleHorse(a); }
      for (const [id, owner] of owners) if (owner === player.id) owners.delete(id);
    },
  };
  seats.set(player.id, seat); return seat;
  };
  const first = host.players.values().next();
  if (first.done === true) throw new Error('Simulation host has no player');
  const firstSeat = seatFor(first.value);
  const others = (): Seat[] => [...seats.values()].filter(seat => seat !== firstSeat);
  host.onStep(rows.step, dt => {
    for (const player of host.players.values()) seatFor(player);
    for (const [id, seat] of seats) {
      if (host.players.get(id) === seat.player) seat.observe(dt);
      else { seat.leave(); seats.delete(id); }
    }
    for (let i = 0; i < Math.min(64, poseRows.length); i++) {
      const row = poseRows[i]; if (row === undefined) throw missingPose;
      const { id, pose } = row;
      const a = host.entities.get(id); if (a === undefined) throw missingPose;
      const bodyDt = host.bodyDt(id); if (bodyDt <= 0) continue;
      const input = pose.input;
      a.samplePose(input); input.speed = a.speed; input.strafe = a.strafe; input.scale = a.scale; input.seed = a.seed;
      input.state = a.state; input.alive = a.alive; input.position = a.position; input.lookTarget = a.lookTarget;
      input.yaw = a.yaw; input.lookWeight = a.lookWeight; input.levelGround = a.levelGround;
      input.flying = a.flying; input.advanceAttack = false; input.desiredSpeed = a.desiredSpeed;
      pose.advance(bodyDt, host.clock.now, false);
    }
  }, {
    snapshot: (): SimValue => {
      const rest = others();
      return { version: 1, ...firstSeat.save(), poses: [...poses].map(([id, pose]) => [id, pose.snapshot()]),
        ...(rest.length === 0 ? {} : { others: Object.fromEntries(rest.map(seat => [seat.player.id, seat.save()])) }) };
    }, restore: value => {
      const state = v.parse(Saved, value), { poses: savedPoses, others: savedOthers = {} } = state;
      firstSeat.check(state);
      const players = Object.entries(savedOthers).map(([id, row]) => {
        const player = host.players.get(id); if (player === undefined) throw new Error('Invalid mounted continuation identity');
        return [seatFor(player), row] as const;
      });
      for (const [seat, row] of players) seat.check(row);
      if (savedPoses.length !== poses.size || new Set(savedPoses.map(([id]) => id)).size !== poses.size) throw new Error('Invalid mounted continuation identity');
      // Validate all pose wires before mutating the installed law.
      for (let i = 0; i < Math.min(64, savedPoses.length); i++) {
        const row = savedPoses[i]; if (row === undefined) throw new Error('Missing saved mounted pose');
        const [id, wire] = row;
        const known = poses.get(id); if (known === undefined) throw new Error('Invalid mounted pose identity');
        new AnimalPoseLaw(known.recipe).restore(wire);
      }
      firstSeat.load(state);
      for (const [seat, row] of players) seat.load(row);
      for (let i = 0; i < Math.min(64, savedPoses.length); i++) {
        const row = savedPoses[i]; if (row === undefined) throw new Error('Missing saved mounted pose');
        poses.get(row[0])?.restore(row[1]);
      }
    }, physicsRestored: () => { for (const seat of seats.values()) seat.reconnect(); },
  }, 'afterBodies');
  // The current motor changes after native restore. Capture the slot, not an expired wrapper/world.
  host.scope.onDispose(() => { for (const seat of seats.values()) { seat.body.motor?.dispose(); seat.body.motor = null; } poses.clear(); installed.delete(host); });
  installed.set(host, { first: firstSeat, seat: id => { const player = host.players.get(id); return player === undefined ? undefined : seatFor(player); } });
  return firstSeat;
}
