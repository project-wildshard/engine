import { Vector3 } from 'three';
import type { Events } from '../../../shared/engine/events/events';
import type { Scope } from '../../../shared/engine/app/scope';
import type { CombatPipeline, CombatTag, DeathCause } from '../../../shared/engine/combat/pipeline';
import type { PlayerHealth } from '../../../shared/engine/combat/health';
import { hardFallHit } from '../../../shared/engine/player/fall';
import { hitShoveSpeed } from '../../../shared/engine/player/shove';

export interface HurtPlayer {
  position: Vector3; yaw: number;
  shove: (x: number, z: number, strength: number) => void;
}
export interface PlayerHurtPorts {
  player: HurtPlayer;
  /** A linked page predicts landing feel but never settles a second fall hit. */
  serverOwned?: () => boolean;
  directional: () => boolean;
  flash: () => void; toast: (text: string) => void;
  combat: (value: number) => void; hurt: (strength: number, pan: number) => void; land: (hard: boolean) => void;
  arc: (x: number, z: number, position: Vector3, yaw: number, damage: number) => void;
  trauma: (value: number) => void;
}
/** The damage event owns presentation; health/rules stay in the simulation service. */
export class PlayerHurt {
  private readonly combat: CombatPipeline;
  private readonly health: PlayerHealth;
  private readonly ports: PlayerHurtPorts;
  constructor(events: Events, scope: Scope, combat: CombatPipeline, health: PlayerHealth, ports: PlayerHurtPorts) {
    this.combat = combat; this.health = health; this.ports = ports;
    events.on('damage.dealt', ({ req, dealt }) => {
      if (req.target !== health) return;
      ports.flash();
      if (req.sourceTags.includes('feel.blow')) {
        this.blow(dealt, req.point);
      } else if (req.sourceTags.includes('feel.jolt')) {
        if (req.toast !== undefined && req.toast !== '') ports.toast(req.toast);
        ports.land(true);
      }
    }, scope);
  }
  /** Present the server's own-player contact; health has already settled elsewhere. */
  serverHit(amount: number, at: Vector3, blow: boolean): void {
    this.ports.flash();
    if (blow) this.blow(amount, at);
  }
  private blow(dealt: number, at: Vector3): void {
    const p = this.ports.player;
    this.ports.combat(0.9);
    if (this.ports.directional()) {
      this.ports.arc(at.x, at.z, p.position, p.yaw, dealt);
      this.ports.trauma(Math.min(0.85, 0.3 + dealt / 40));
    }
    p.shove(at.x, at.z, hitShoveSpeed(dealt));
    const dx = at.x - p.position.x, dz = at.z - p.position.z, d = Math.hypot(dx, dz);
    this.ports.hurt(dealt / 20, d > 0.3 ? ((dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) / d) * 0.7 : 0);
  }
  creature(a: { kind: string; label: string; position: Vector3 }, amount: number): void {
    this.combat.hit({ source: 'env', sourceTags: [`creature.${a.kind}`, 'feel.blow', 'cover.checked'],
      target: this.health, amount, point: a.position.clone(), dir: new Vector3(), cause: { kind: a.kind, label: a.label } });
  }
  jolt(tag: CombatTag, amount: number, cause: DeathCause, toast?: string): void {
    this.combat.hit({ source: 'env', sourceTags: [tag, 'feel.jolt', 'cover.checked'],
      target: this.health, amount, point: this.ports.player.position.clone(), dir: new Vector3(), cause,
      ...(toast === undefined ? {} : { toast }) });
  }
  fall(hard: boolean): void {
    this.ports.land(hard);
    if (hard && this.ports.serverOwned?.() !== true) this.combat.hit(hardFallHit(this.health, this.ports.player.position));
  }
}
