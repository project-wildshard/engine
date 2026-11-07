/** The open arena's room (P1-E3.4, J104, J107): what `OpenArenaFight` asks of "the player", answered for every player of a
 *  SimHost. The fight deals with the living player nearest the arena's centre inside it; contacts land on that player and
 *  share by the curve; a player who falls goes back alone. A lone player is every answer, unread. */
import { Vector3 } from 'three';
import type { BossBrain, BossScript } from '@wildshard/engine/ai/BossBrain';
import { BossContenders } from '@wildshard/engine/ai/bossContenders';
import { bossHealthScale } from '@wildshard/engine/ai/bossScale';
import { canReach } from '@wildshard/engine/ai/reach';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import type { SimHost } from '@wildshard/engine/sim';
import { NO_MOMENTS, publishEncounter, type EncounterReward } from '@wildshard/engine/sim/encounterRows';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import type { ArenaScriptData } from '@wildshard/format/arenaScriptRows';
import { mountedPlayerOf } from '../riding/native';
import { BossBounty } from './bounty';

type RoomBoss = Parameters<BossContenders['fell']>[1];
const _up = new Vector3();

export class OpenArenaRoom {
  readonly party: BossContenders;
  /** J105: a heart is no creature in the damage book, so its earners are those in the arena when it falls. */
  readonly bounty: BossBounty;
  /** Hits the fight has landed, on anyone. */
  contacts = 0;
  private readonly strikes = new StrikeRunner();
  private readonly rows = new Map<string, StrikeSpec>();
  private readonly centre: Vector3;
  private readonly tag: `boss.${string}`;
  constructor(private readonly host: SimHost, private readonly data: ArenaScriptData, place: (player: PlayerSim, position: Vector3, yaw: number) => void) {
    const { center } = data.arena, radius = data.place.arenaRadius; this.centre = new Vector3(center.x, 0, center.z); this.tag = `boss.${data.record.kind}`;
    for (const [name, row] of Object.entries(data.contacts)) this.rows.set(name, strikeFromData(row));
    const inside = (point: { readonly x: number; readonly z: number }): boolean => (point.x - center.x) ** 2 + (point.z - center.z) ** 2 < radius ** 2;
    this.party = new BossContenders(host.players, inside, place);
    this.bounty = new BossBounty(host, () => null, data.definition.id); this.inside = inside;
  }
  private readonly inside: (point: { readonly x: number; readonly z: number }) => boolean;
  /** The heart has fallen: name who earned it. Alone there is no one to name. */
  readonly heartFell = (): void => {
    if (this.host.players.size > 1) this.bounty.award([...this.host.players.values()].filter(player => this.inside(player.position)).map(player => player.id));
  };
  /** Whom the fight deals with now. */
  get near(): PlayerSim { return this.party.nearest(this.centre); }
  get player(): { readonly position: Vector3 } { return this.party.player; }
  readonly mounted = (): boolean => mountedPlayerOf(this.host, this.near.id)?.mounted === true;
  readonly throwRider = (): void => { mountedPlayerOf(this.host, this.near.id)?.dismount(true); };
  readonly horseSteed = (amount: number): void => { const seat = mountedPlayerOf(this.host, this.near.id); if (seat !== undefined) seat.body.steed = Math.max(0, seat.body.steed + amount); };
  readonly heartScale = (): number => bossHealthScale(this.party.engaged);
  /** A contact row against the player nearest: the whole-arena rows land unchecked, the rest by their shape and cover. */
  readonly contact = (name: string, origin: Vector3, amount: number, why: string): boolean => {
    const { data, host } = this, player = this.near, target = player.position;
    if (!data.whole.includes(name)) {
      const row = this.rows.get(name); if (row === undefined) throw new Error('Missing admitted arena contact');
      if (!this.strikes.contains(row, { actor: { position: origin, scale: 1, yaw: 0 }, target })) return false;
      if (!row.tags.includes('cover.exempt') && !canReach({ position: origin, scale: 1, dims: { bodyY: 1.2, bodyRadius: .1 }, headWorld: out => out.copy(origin).add(_up.set(0, 1.2, 0)) }, target, host.physics)) return false;
    }
    host.combat.hit({ source: 'env', sourceTags: [this.tag, 'feel.jolt', 'cover.checked'], target: player.health, amount, point: target.clone(), dir: new Vector3(),
      cause: { kind: data.record.kind, label: data.definition.name }, toast: why });
    this.contacts++; return true;
  };
  /** A room's deaths and shares once the brain exists, and the fight's row for every client. */
  bind(boss: RoomBoss & Pick<BossBrain, 'state' | 'phase' | 'skipHeldFor'>, fight: Pick<BossScript, 'hpFrac' | 'shielded'>, reward: () => EncounterReward | null): void {
    const { host, party } = this;
    publishEncounter(host, this.data.definition.id, () => ({ ...NO_MOMENTS, kind: 'boss', state: boss.state, hp: fight.hpFrac, phase: boss.phase, shield: fight.shielded || boss.state === 'beat', body: null, skip: boss.skipHeldFor, reward: reward() }));
    host.events.on('player.died', ({ actor }) => { if (host.players.size > 1) party.fell(actor.id, boss); }, host.scope);
    host.events.on('damage.dealt', ({ req }) => { if (party.owns(req, null, this.tag)) party.echo(req, { position: this.centre }, host.combat); }, host.scope);
  }
}
