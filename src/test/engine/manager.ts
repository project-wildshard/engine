import { AnimalHerdView } from '../../client/engine/entities/AnimalHerdView';
import { AnimalManager } from '../../server/engine/entities/AnimalManager';
import { StalkerBrain } from '../../shared/engine/ai/stalker';
import { fakeWorld } from './world';
import { app } from '../../client/engine/app/runtime';
import { TickScheduler, type TickActor } from '../../shared/engine/app/scheduler';
import type { Animal } from '../../client/engine/entities/AnimalView';

/** Frozen pre-S2.6 clock for the existing approach goldens; new band tests use the real scheduler. */
class LegacyClock extends TickScheduler {
  private accumulator = 0;
  private dt = 0;
  ready = false;
  override beginFrame(dt: number): void {
    this.dt = dt; this.accumulator += dt; this.ready = this.accumulator >= 0.1;
    if (this.ready) this.accumulator -= 0.1;
  }
  override takeBrainDt(_id: string, _actor: TickActor): number { return this.ready ? 0.1 : 0; }
  override bodyDt(_id: string, _actor: TickActor): number { return this.dt; }
}

/** Real manager without the canvas-only blood presentation. The caller owns active-shard/physics cleanup. */
export function manager({ legacyClock = false } = {}): ReturnType<typeof fakeWorld> & { manager: AnimalManager; advance: (n: number) => void } {
  const f = fakeWorld(), view = new AnimalHerdView(f.game.scene, f.sky, { style: 'toon', render: { lowPoly: true, waitForModels: false, furRim: false, tintRange: 0.3, oneMaterial: true } });
  const m = new AnimalManager(view, app, f.forest);
  Reflect.set(view, 'blood', { update: (): void => undefined, burst: (): void => undefined });
  if (legacyClock) {
    const scheduler = new LegacyClock(), prev = f.player.position.clone();
    let initialized = false, speed = 0;
    // the decision tick is the manager's; the charge body clock is the hunting brain's (src/shared/engine/ai/stalker.ts hunt pattern, SF82)
    const hunt: unknown = Reflect.get(m, 'hunt');
    if (!(hunt instanceof StalkerBrain)) throw new Error('Manager hunting brain moved');
    const think: unknown = Reflect.get(m, 'think'), charge: unknown = Reflect.get(hunt, 'advanceCharge');
    if (typeof think !== 'function' || typeof charge !== 'function') throw new Error('Manager decision/body hooks moved');
    Reflect.set(m, 'scheduler', scheduler);
    Reflect.set(hunt, 'advanceCharge', () => undefined);
    Reflect.set(m, 'interrupt', () => undefined);
    Reflect.set(m, 'think', (a: Animal, dt: number, player: typeof prev, sprinting: boolean) => {
      if (!initialized) { prev.copy(player); initialized = true; }
      const moved = Math.hypot(player.x - prev.x, player.z - prev.z); prev.copy(player);
      speed += (Math.min(moved / 0.1, 9) - speed) * 0.5; Reflect.set(m, 'playerSpeed', speed);
      const charging = a.state === 'charge';
      Reflect.apply(think, m, [a, dt, player, sprinting]);
      if (charging && a.state === 'charge') Reflect.apply(charge, hunt, [a, dt, player]);
    });
  }
  f.game.onUpdate((dt, t) => { m.update(dt, t, f.player.position); }, 'manager', true);
  return { ...f, manager: m, advance(n): void { for (let i = 0; i < n; i++) f.game.advance(1 / 60); if (f.game.dead) throw new Error('manager fixture faulted'); } };
}

/** The manager's hunting brain (src/shared/engine/ai/stalker.ts hunt pattern, SF82): the herd animals' memories and charge body clock. */
export function huntOf(m: AnimalManager): StalkerBrain<Animal> {
  const hunt: unknown = Reflect.get(m, 'hunt');
  if (!isHunt(hunt)) throw new Error('Manager hunting brain moved');
  return hunt;
}
/** The manager owns the canonical hunt-pattern StalkerBrain over its Animals. */
function isHunt(value: unknown): value is StalkerBrain<Animal> { return value instanceof StalkerBrain; }
