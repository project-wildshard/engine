import type { MoveResult } from '../physics/CharacterMotor';
import type { PlayerSim } from '../../../server/engine/sim/playerSim';
import { PLAYER } from '@wildshard/wire/classes';
import { bindClass, type NetSchema } from './schema';

// P1-E5.2 (E5-REPLICATION §3.5, §4.3), P1-E5.3-C2: how a server reads the player's wire fields. Their ids, forms and
// audience live in `@wildshard/wire` (WIRE-STABILITY WR2); a field there with no accessor here fails the typecheck.
// Others interpolate a quantised row; the owner gets back all the motion state a step reads, exact, 30 times a second,
// so a correction replays from what the server had.
// J140: position and velocity go as doubles. A client and a server hold the same bits or they don't, and a slide isn't stable
// against a micrometre, so a correction rounded to a float only lands the next one.
// A null is NaN. The mount comes with D3. `yaw` stays out: the view is the client's own.
const orNaN = (value: number | null | undefined): number => value ?? Number.NaN;
/** The last move's ground, as a body with no capsule has it. */
const NO_GROUND: Pick<MoveResult, 'grounded' | 'groundNormalY' | 'downhillX' | 'downhillZ' | 'horizontalFreedom'> = { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1 };
const ground = (player: PlayerSim): typeof NO_GROUND => player.hasMotor ? player.motor.result : NO_GROUND;

/** The `player` class: a row for everyone else, an exact owner block for its owner. */
export const PLAYER_NET: NetSchema<PlayerSim> = bindClass<PlayerSim, typeof PLAYER>(PLAYER, {
  x: player => player.position.x,
  y: player => player.position.y,
  z: player => player.position.z,
  yaw: player => player.yaw,
  name: player => player.netName,
  board: player => player.board.on,
  swim: player => player.swim.on,
  hp: player => Math.ceil(player.health.attributes.health),
  maxHp: player => Math.ceil(player.health.attributes.maxHealth),
  statusStun: player => player.health.attributes['statusStun'] ?? 0,
  held: player => player.held,
  // REMOTE-PLAYERS RP6: what another page animates. The owner has its own swing and ground.
  swing: player => player.swing.count,
  heavy: player => player.swing.heavy,
  // Off the ground under its own motion: a cable, a stun and a boat's deck pin the body with `grounded` false and no vertical speed.
  air: player => !player.fall.grounded && !player.swim.on && !player.carried && !player.moveLocked && player.velocity.y !== 0,
  px: player => player.position.x,
  py: player => player.position.y,
  pz: player => player.position.z,
  vx: player => player.velocity.x,
  vy: player => player.velocity.y,
  vz: player => player.velocity.z,
  grounded: player => player.fall.grounded,
  dashT: player => player.dash.t,
  dodgeT: player => player.dodge.t,
  dodgeCd: player => player.dodge.cd,
  shoveT: player => player.shove.t,
  shoveX: player => player.shove.vx,
  shoveZ: player => player.shove.vz,
  dashX: player => player.dash.vx,
  dashZ: player => player.dash.vz,
  impulseX: player => player.impulse.x,
  impulseY: player => player.impulse.y,
  impulseZ: player => player.impulse.z,
  lockR0: player => player.lock.r0,
  jumpAgo: player => player.jump.ago,
  jumpLeft: player => player.jump.left,
  hoverAir: player => player.board.hoverAir,
  hoverBob: player => player.board.hoverBob,
  stood: player => player.swim.stood,
  diving: player => player.swim.diving,
  climbTo: player => orNaN(player.swim.climbTo),
  climbCooldown: player => player.swim.climbCooldown,
  strokeTime: player => player.swim.strokeTime,
  water: player => orNaN(player.footing.water),
  depth: player => player.footing.depth,
  wading: player => player.footing.wading,
  onPlatform: player => player.footing.onPlatform,
  sliding: player => player.footing.sliding,
  motorGrounded: player => ground(player).grounded,
  groundNormalY: player => ground(player).groundNormalY,
  downhillX: player => ground(player).downhillX,
  downhillZ: player => ground(player).downhillZ,
  freedom: player => ground(player).horizontalFreedom,
  // what the server alone decides: the client reads these, never predicts them
  swingPhase: player => orNaN(player.swing.t),
  lastSwingSeq: player => player.swing.seq,
  moveScale: player => player.moveScale,
  resets: player => player.resets % 0x10000,
  led: player => player.led,
});
