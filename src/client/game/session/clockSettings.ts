import type { Scope } from '@wildshard/engine/app/scope';
import type { App } from '@wildshard/engine/app/app';
import { onSettingChange, setting, type Settings } from '@wildshard/engine/ui/Settings';
import type { DayCycleClock, TimePick } from '@wildshard/engine/world/dayCycle';
import { wirePage } from '../shardfile/wirePage';

const pageSettings = { setting, onSettingChange };
/** On the wire the day is the server's: a Developer's pick goes up as well. */
const sayTime = (time: TimePick): void => { wirePage.climate({ op: 'time', name: time, at: 0 }); };

/** Apply an explicit Developer time at resident-clock binding; Live preserves authored starts and fixed overrides. */
export function bindClockSettings(clock: DayCycleClock, scope: Scope, settings: Pick<Settings, 'setting' | 'onSettingChange'> = pageSettings): void {
  const initial = settings.setting('time');
  if (initial !== 'live') { clock.setTime(initial); sayTime(initial); }
  scope.onDispose(settings.onSettingChange('time', (time) => { clock.setTime(time); sayTime(time); }));
}

/** R12: the day clocks of runtimes' own skies, each on the scope that owns its sky (a grid region's world, a painted sky's
 *  runtime); `enterSkyClock` makes the one nearest an entered runtime the day cycle while it is entered. */
const skyClocks = new Map<Scope, DayCycleClock>();
/** the live entries, told when a sky publishes its clock (a painted sky is built after its runtime's entry) */
const entries = new Set<() => void>();

/** Publish the day clock `scope`'s own sky runs on, until `scope` ends. */
export function publishSkyClock(scope: Scope, clock: DayCycleClock): void {
  if (scope.disposed || scope.disposing) return;
  skyClocks.set(scope, clock);
  scope.onDispose(() => { if (skyClocks.get(scope) === clock) skyClocks.delete(scope); });
  for (const entry of entries) entry();
}

/** The sky clock published within one of `owners` (on it or a scope it holds: a grid runtime holds its region's world),
 *  else on its nearest ancestor; the first owner's first; null when none is. */
export function skyClockOf(owners: readonly Scope[]): DayCycleClock | null {
  for (const scope of owners) {
    for (const [owner, clock] of skyClocks) if (owner.belongsTo(scope)) return clock;
    let nearest: Scope | null = null;
    for (const owner of skyClocks.keys()) if (scope.belongsTo(owner) && (nearest === null || owner.belongsTo(nearest))) nearest = owner;
    if (nearest !== null) return skyClocks.get(nearest) ?? null;
  }
  return null;
}

/**
 * While `entered` lives, the sky clock of the runtime `owners` hold is the app's day cycle (Settings, the light presets, the
 * day badge read the sky the player stands under) and Settings ▸ Time turns it; the level's clock returns when `entered`
 * ends. An explicit Developer time is applied on entry (Live keeps the clock as it is), so a re-entry finds it unreset.
 */
export function enterSkyClock(app: Pick<App, 'enterDayCycle'>, owners: readonly Scope[], entered: Scope, settings: Pick<Settings, 'setting' | 'onSettingChange'> = pageSettings): void {
  let current: DayCycleClock | null = null;
  const read = (): DayCycleClock | null => {
    const clock = skyClockOf(owners);
    if (clock !== null && clock !== current) {
      current = clock;
      const initial = settings.setting('time');
      if (initial !== 'live') { clock.setTime(initial); sayTime(initial); }
    }
    return clock;
  };
  app.enterDayCycle(read, entered);
  // the entry's Developer time reaches a sky published after it (Nalati's painted sky is built at play, G667)
  const seen = (): void => { read(); };
  entries.add(seen); entered.onDispose(() => { entries.delete(seen); });
  read();
  entered.onDispose(settings.onSettingChange('time', (time) => { current = skyClockOf(owners); current?.setTime(time); sayTime(time); }));
}
