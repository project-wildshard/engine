import type { Vector3 } from 'three';
import type { CombatPipeline, DamageRequest } from '../../../shared/engine/combat/pipeline';
import type { PlayerSim } from '../sim/playerSim';
import { bossHealthScale, bossTargetCount } from '../../../shared/engine/ai/bossScale';

/** What a fight's contenders ask of its brain. */
interface ContendedBoss {
  readonly engaged: boolean;
  readonly script: { readonly respawnPoint: () => { pos: Vector3; yaw: number } };
  readonly disarm: () => void; readonly arm: () => void; readonly onPlayerDeath: () => boolean;
  /** SC5: the brain's state, read for a beaten boss's return, and its own way back (else a plain `disarm`). SC10: `defeated`, its record,
   *  for a boss whose presence puts it away after a win (a roaming boss leaves `victory` for `dormant` when everyone walks off). */
  readonly state?: string; readonly defeated?: boolean; readonly returnBeaten?: () => void;
}
/** SERVER-CELLS SC5 (J328): how a served world brings a beaten boss back, since a grid cell's world is never rebuilt. `rearm`: the
 *  boss stood armed from the start, so it stands armed again; a summoned one goes back to waiting for its summons. */
export interface BeatenReturn { readonly served: () => boolean; readonly rearm: boolean }
/** SC5: a served world's beaten boss comes back once nobody has stood in its arena this long, as J107's start-over waited. */
export const BOSS_RETURN_S = 300;
type ArenaPlayer = (point: Vector3) => boolean;
/** Marks a blow's share on a further player, which lands no further shares. */
const ECHO = 'boss.echo';

/**
 * The players one boss fight deals with (J104, J107). `BossBrain` watches one point and sends "the player" back on a death.
 * In a room that point is whoever stands past the threshold; a player who falls goes back to the checkpoint alone and the
 * room carries on, progress kept; the fight resets only when everyone has left. Those engaged at its start set its health
 * and how many players each of its blows lands on, by the platform's curves. A lone player never reaches any of this:
 * its death is the brain's own, and it fights at exactly the authored numbers.
 */
export class BossContenders {
  private returning: readonly PlayerSim[] | null = null;
  /** Players past the threshold when the fight began; 0 outside a room's fight. */
  private counted = 0;
  private readonly players: ReadonlyMap<string, PlayerSim>;
  private readonly inArena: ArenaPlayer;
  private readonly place: (player: PlayerSim, position: Vector3, yaw: number) => void;
  private readonly beaten: BeatenReturn | undefined;
  /** SC5: seconds a beaten boss's arena has stood empty. */
  private emptyFor = 0;
  /** The point `BossBrain` watches, live. */
  readonly player: { readonly position: Vector3 };
  constructor(players: ReadonlyMap<string, PlayerSim>, inArena: ArenaPlayer, place: (player: PlayerSim, position: Vector3, yaw: number) => void, beaten?: BeatenReturn) {
    this.players = players; this.inArena = inArena; this.place = place; this.beaten = beaten;
    const contender = (): PlayerSim => this.contender();
    this.player = { get position() { return contender().position; } };
  }
  private first(): PlayerSim {
    const first = this.players.values().next();
    if (first.done === true) throw new Error('Simulation host has no player');
    return first.value;
  }
  private contender(): PlayerSim {
    if (this.players.size > 1) for (const player of this.players.values()) if (this.inArena(player.position)) return player;
    return this.first();
  }
  private inside(): PlayerSim[] { return [...this.players.values()].filter(player => this.inArena(player.position)); }
  /** Whom a body deals with: the living player past the threshold nearest it, else the contender. Unread for a lone player. */
  nearest(point: { readonly x: number; readonly y: number; readonly z: number }): PlayerSim {
    if (this.players.size <= 1) return this.first();
    let best: PlayerSim | null = null, bestScore = Infinity;
    for (const player of this.inside()) {
      const score = player.health.alive ? player.position.distanceToSquared(point) : Infinity;
      if (best === null || score < bestScore) { best = player; bestScore = score; }
    }
    return best ?? this.contender();
  }
  /** The brain's respawn: who fell, or a lone player. */
  readonly respawn = (position: Vector3, yaw: number): void => {
    for (const player of this.returning ?? this.players.values()) this.place(player, position, yaw);
  };
  /** Every player turns with the intro's camera. */
  readonly faceToward = (target: Vector3): void => {
    for (const player of this.players.values()) player.yaw = Math.atan2(player.position.x - target.x, player.position.z - target.z);
  };
  /** A room's death: true when this fight owned it. The fallen goes back alone; the fight is untouched. */
  fell(id: string, boss: ContendedBoss): boolean {
    const player = this.players.get(id);
    if (!boss.engaged || player === undefined) return false;
    const { pos, yaw } = boss.script.respawnPoint();
    this.returning = [player];
    try { this.respawn(pos, yaw); } finally { this.returning = null; }
    return true;
  }
  /** The death checkpoint's answer. A room's only says the fight owns the death (`fell` returns them); a lone player's is the brain's. */
  died(boss: ContendedBoss): boolean { return this.players.size > 1 ? boss.engaged : boss.onPlayerDeath(); }
  /** Each fixed step, before the brain's: count who began the fight, and reset it once nobody is left inside. */
  observe(boss: ContendedBoss, dt: number = 1 / 60): void {
    if (this.beaten !== undefined && (boss.state === 'victory' || (boss.defeated === true && !boss.engaged)) && this.beaten.served()) { this.unbeaten(boss, this.beaten, dt); return; }
    this.emptyFor = 0;
    if (this.players.size <= 1 && this.counted === 0) return;
    if (!boss.engaged) { this.counted = 0; return; }
    const inside = this.inside().length;
    if (this.counted === 0) this.counted = Math.max(1, inside);
    if (inside === 0) { this.counted = 0; boss.disarm(); boss.arm(); }
  }
  /** SC5: a served world's beaten boss, back once its arena has stood empty `BOSS_RETURN_S`; anyone inside starts the wait over. */
  private unbeaten(boss: ContendedBoss, beaten: BeatenReturn, dt: number): void {
    if (this.inside().length > 0) { this.emptyFor = 0; return; }
    this.emptyFor += dt;
    if (this.emptyFor < BOSS_RETURN_S) return;
    this.emptyFor = 0; this.counted = 0;
    if (boss.returnBeaten === undefined) boss.disarm(); else boss.returnBeaten();
    if (beaten.rearm) boss.arm();
  }
  /** SC10: the cell slept this long with nobody in it, so nobody stood in the arena: a beaten boss's wait spends it. */
  slept(seconds: number): void { if (this.beaten !== undefined) this.emptyFor += seconds; }
  /** Players counted at the fight's start, for a continuation: 0 in any one-player fight. */
  get engaged(): number { return this.counted; }
  restoreEngaged(count: number): void { this.counted = count; }
  /** A hit on the body, over the health curve: the body keeps its authored hit points. */
  scaled(request: DamageRequest): DamageRequest { return this.counted <= 1 ? request : { ...request, amount: request.amount / bossHealthScale(this.counted) }; }
  /** Whether a dealt blow is this fight's: the body's own, or a hazard's under the fight's `hazard` tag (env-sourced). */
  owns(request: DamageRequest, body: { combatActor: () => unknown } | null, hazard: string | undefined): boolean {
    return (body !== null && request.source === body.combatActor()) || (hazard !== undefined && request.source === 'env' && request.sourceTags.some(tag => tag === hazard));
  }
  /** A blow the body landed on one player also lands on the next nearest, up to the curve's count. */
  echo(request: DamageRequest, body: { readonly position: Vector3 }, combat: Pick<CombatPipeline, 'hit'>): void {
    const count = bossTargetCount(this.counted);
    if (count <= 1 || request.sourceTags.includes(ECHO)) return;
    const others = this.inside().filter(player => player.health !== request.target && player.health.alive)
      .sort((a, b) => a.position.distanceToSquared(body.position) - b.position.distanceToSquared(body.position)).slice(0, count - 1);
    for (const player of others) combat.hit({ ...request, target: player.health, sourceTags: [...request.sourceTags, ECHO], point: body.position.clone() });
  }
}
