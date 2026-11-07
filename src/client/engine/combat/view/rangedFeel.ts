import { app } from '../../app/runtime';
import type { Scope } from '../../../../shared/engine/app/scope';
import type { Game } from '../../core/Game';
import type { Events } from '../../../../shared/engine/events/events';
import type { EquipmentRow, EquipmentId } from '../../../../shared/engine/combat/Equipment';
import { resolveHitStop } from '../cues';
import { CameraFX } from '../../player/CameraFX';
import { Impacts, type ImpactKind } from '../../fx/Impacts';
import { worldHit } from './ranged';
import { Vector3 } from 'three';

/** Entered-only listeners for previously prepared camera/debris resources. */
export type RangedFeelInstaller = (events: Events, scope: Scope, rowFor: (id: EquipmentId) => EquipmentRow | undefined) => void;

/** Build the same inert effect resources before shader warm-up. No weapon listener or burst is installed until entry. */
export function prepareRangedFeel(game: Game): RangedFeelInstaller {
  const fx = CameraFX.for(game), impacts = Impacts.for(game);
  return (events, scope, rowFor) => {
    const dir = new Vector3(), a = new Vector3(), b = new Vector3();
    events.on('weapon.hit', ({ id, kind, headshot, killed }) => {
      const row = rowFor(id), profile = row?.rangedFeel;
      if (profile === undefined) return;
      if (row?.hitStop) game.hitStop(resolveHitStop(row.hitStop, headshot, killed));
      const { kick, trauma } = profile;
      fx.kick(killed ? kick.kill : headshot ? kick.head : kick.body, (app.rng.stream('cosmetic').next() - 0.5) * (killed ? kick.killSide : kick.side));
      if ((killed && trauma.killKinds.includes(kind)) || (headshot && trauma.headKinds.includes(kind))) fx.addTrauma(killed ? trauma.kill : trauma.head);
    }, scope);
    events.on('weapon.impact', ({ id, surface, point }) => {
      if (rowFor(id)?.rangedFeel === undefined || surface === 'flesh') return;
      dir.subVectors(point, game.camera.position).normalize();
      a.copy(point).addScaledVector(dir, -0.4); b.copy(point).addScaledVector(dir, 0.6);
      const material = surface === 'wood' ? 'wood' : worldHit(a, b, 0)?.material ?? 'ground';
      const kind: ImpactKind = material === 'wood' || material === 'planks' ? 'wood' : material === 'rock' || material === 'stone' || material === 'metal' ? 'stone' : 'dirt';
      dir.negate();
      impacts.burst(kind, point, dir, kind === 'wood' ? 8 : 9);
      if (kind === 'stone') impacts.burst('sparks', point, dir, 4);
    }, scope);
  };
}
