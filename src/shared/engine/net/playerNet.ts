import type { MoveResult } from '../physics/CharacterMotor';
import type { PlayerSim } from '../../../server/engine/sim/playerSim';
import { netSchema, type NetSchema } from './schema';

// P1-E5.2 (E5-REPLICATION §3.5, §4.3), P1-E5.3-C2: the player's wire fields. Others interpolate a quantised row; the owner
// gets back all the motion state a step reads, exact, 30 times a second, so a correction replays from what the server had.
// J140: position and velocity go as doubles. A client and a server hold the same bits or they don't, and a slide isn't stable
// against a micrometre, so a correction rounded to a float only lands the next one.
// A null is NaN. The mount comes with D3. `yaw` stays out: the view is the client's own.
const metres = { kind: 'f32q', min: -260, max: 260, bits: 16 } as const;
const orNaN = (value: number | null | undefined): number => value ?? Number.NaN;
/** The last move's ground, as a body with no capsule has it. */
const NO_GROUND: Pick<MoveResult, 'grounded' | 'groundNormalY' | 'downhillX' | 'downhillZ' | 'horizontalFreedom'> = { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1 };
const ground = (player: PlayerSim): typeof NO_GROUND => player.hasMotor ? player.motor.result : NO_GROUND;

/** The `player` class: a row for everyone else, an exact owner block for its owner. */
export const PLAYER_NET: NetSchema<PlayerSim> = netSchema<PlayerSim>({
  cls: 'player',
  fields: {
    x: { ...metres, send: 'others', read: player => player.position.x },
    y: { ...metres, send: 'others', read: player => player.position.y },
    z: { ...metres, send: 'others', read: player => player.position.z },
    yaw: { kind: 'angle', bits: 10, send: 'others', read: player => player.yaw },
    board: { kind: 'bool', read: player => player.board.on },
    swim: { kind: 'bool', read: player => player.swim.on },
    hp: { kind: 'u16', read: player => Math.ceil(player.health.attributes.health) },
    maxHp: { kind: 'u16', send: 'owner', read: player => Math.ceil(player.health.attributes.maxHealth) },
    statusStun: { kind: 'f32', send: 'owner', read: player => player.health.attributes['statusStun'] ?? 0 },
    held: { kind: 'u8', read: player => player.held },
    px: { kind: 'f64', predicted: true, read: player => player.position.x },
    py: { kind: 'f64', predicted: true, read: player => player.position.y },
    pz: { kind: 'f64', predicted: true, read: player => player.position.z },
    vx: { kind: 'f64', predicted: true, read: player => player.velocity.x },
    vy: { kind: 'f64', predicted: true, read: player => player.velocity.y },
    vz: { kind: 'f64', predicted: true, read: player => player.velocity.z },
    grounded: { kind: 'bool', predicted: true, read: player => player.fall.grounded },
    dashT: { kind: 'f32', predicted: true, read: player => player.dash.t },
    dodgeT: { kind: 'f32', predicted: true, read: player => player.dodge.t },
    dodgeCd: { kind: 'f32', predicted: true, read: player => player.dodge.cd },
    shoveT: { kind: 'f32', predicted: true, read: player => player.shove.t },
    shoveX: { kind: 'f32', predicted: true, read: player => player.shove.vx },
    shoveZ: { kind: 'f32', predicted: true, read: player => player.shove.vz },
    dashX: { kind: 'f32', predicted: true, read: player => player.dash.vx },
    dashZ: { kind: 'f32', predicted: true, read: player => player.dash.vz },
    impulseX: { kind: 'f32', predicted: true, read: player => player.impulse.x },
    impulseY: { kind: 'f32', predicted: true, read: player => player.impulse.y },
    impulseZ: { kind: 'f32', predicted: true, read: player => player.impulse.z },
    lockR0: { kind: 'f32', predicted: true, read: player => player.lock.r0 },
    jumpAgo: { kind: 'f32', predicted: true, read: player => player.jump.ago },
    jumpLeft: { kind: 'f32', predicted: true, read: player => player.jump.left },
    hoverAir: { kind: 'bool', predicted: true, read: player => player.board.hoverAir },
    hoverBob: { kind: 'f32', predicted: true, read: player => player.board.hoverBob },
    stood: { kind: 'bool', predicted: true, read: player => player.swim.stood },
    diving: { kind: 'bool', predicted: true, read: player => player.swim.diving },
    climbTo: { kind: 'f32', predicted: true, read: player => orNaN(player.swim.climbTo) },
    climbCooldown: { kind: 'f32', predicted: true, read: player => player.swim.climbCooldown },
    strokeTime: { kind: 'f32', predicted: true, read: player => player.swim.strokeTime },
    water: { kind: 'f32', predicted: true, read: player => orNaN(player.footing.water) },
    depth: { kind: 'f32', predicted: true, read: player => player.footing.depth },
    wading: { kind: 'bool', predicted: true, read: player => player.footing.wading },
    onPlatform: { kind: 'bool', predicted: true, read: player => player.footing.onPlatform },
    sliding: { kind: 'bool', predicted: true, read: player => player.footing.sliding },
    motorGrounded: { kind: 'bool', predicted: true, read: player => ground(player).grounded },
    groundNormalY: { kind: 'f32', predicted: true, read: player => ground(player).groundNormalY },
    downhillX: { kind: 'f32', predicted: true, read: player => ground(player).downhillX },
    downhillZ: { kind: 'f32', predicted: true, read: player => ground(player).downhillZ },
    freedom: { kind: 'f32', predicted: true, read: player => ground(player).horizontalFreedom },
    // what the server alone decides: the client reads these, never predicts them
    swingPhase: { kind: 'f32', send: 'owner', read: player => orNaN(player.swing.t) },
    lastSwingSeq: { kind: 'u16', send: 'owner', read: player => player.swing.seq },
    moveScale: { kind: 'f32', send: 'owner', read: player => player.moveScale },
    resets: { kind: 'u16', send: 'owner', read: player => player.resets % 0x10000 },
    led: { kind: 'bool', send: 'owner', read: player => player.led },
  },
});
