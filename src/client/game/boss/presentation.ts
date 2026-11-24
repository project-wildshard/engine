/** Client-only presentation of wake encounter effect rows on the existing
 * boss bar and event bus. No shard renderer callback or port is accepted. */
import type { BossBar } from '@wildshard/engine/ui/BossBar';
import type { Events } from '@wildshard/engine/events/events';
import type { WakeBossEncounter } from '../../../shared/game/boss/wake';

/** Apply the value machine's ordered effects once, on the caller's UI clock. */
export function presentWakeBoss(encounter: WakeBossEncounter, bar: BossBar, events: Events): void {
  for (const effect of encounter.takeEffects()) {
    if (effect.kind === 'outcome') events.emit('boss.attempt', { boss: encounter.row.id, level: encounter.row.level, outcome: effect.outcome });
    else if (effect.kind === 'hide') bar.hideBar();
    else {
      if (effect.visible && !bar.barShown) bar.showBar(encounter.row.name, encounter.row.presentation.cuts);
      else if (!effect.visible) bar.hideBar();
      bar.setHp(effect.hp);
    }
  }
}
