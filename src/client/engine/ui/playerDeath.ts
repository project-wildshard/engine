import type { Vector3 } from 'three';
import type { Events } from '../../../shared/engine/events/events';
import type { Scope } from '../../../shared/engine/app/scope';
import type { Actor, DeathCause } from '../../../shared/engine/combat/pipeline';

/** Health emits death; this scope-owned presentation/respawn subscriber runs after queued hurt feedback. */
export function installPlayerDeath(events: Events, scope: Scope, actor: Actor, ports: {
    active?: () => boolean; position: () => Vector3;
    died: (cause: DeathCause | undefined, checkpoint: boolean) => void;
  }): void {
    events.on('player.died', (event) => {
      if (event.actor !== actor || ports.active?.() === false) return;
      ports.died(event.cause, event.checkpoint);
      events.emit('player.respawned', { at: ports.position().clone(), checkpoint: event.checkpoint });
    }, scope);
}
