import type { Scope } from '@wildshard/engine/app/scope';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';

const callbacks = new Set<PropertyKey>(['onFire', 'onHit', 'onImpact', 'onReloadStart', 'onReloadEnd', 'onDry', 'onSwap', 'onUnlock']);

/** One page controls object; the entered kit changes underneath it without rebuilding controls or lending ownership. */
export class EnteredEquipment {
  readonly service: EquipmentService;
  private active: EquipmentService;
  constructor(private readonly road: EquipmentService) {
    this.active = road;
    this.service = new Proxy(road, {
      get: (_target, key) => {
        const active = this.active;
        if (key === 'tools') return [...road.tools, ...active.tools.filter(tool => !road.tools.some(platform => platform.id === tool.id))];
        // The regional owner ticks its weapon once; the page still ticks its carried platform tools on every frame.
        if (callbacks.has(key)) { const callback: unknown = Reflect.get(road, key, road); return callback; }
        if (key === 'update' || key === 'dispose') {
          const value: unknown = Reflect.get(road, key, road);
          const bound: unknown = typeof value === 'function' ? value.bind(road) : value;
          return bound;
        }
        if (key === 'has' || key === 'unlock') return (id: Parameters<EquipmentService['has']>[0]) => {
          const owner = road.tools.some(tool => tool.id === id) ? road : active;
          if (key === 'has') return owner.has(id);
          owner.unlock(id); return undefined;
        };
        if (key === 'setEnabled') return (on: boolean) => { this.service.enabled = on; };
        const value: unknown = Reflect.get(active, key, active);
        const bound: unknown = typeof value === 'function' ? value.bind(active) : value;
        return bound;
      },
      set: (_target, key, value: unknown) => {
        if (callbacks.has(key)) return Reflect.set(road, key, value, road);
        if (key === 'enabled' && this.active !== road) Reflect.set(road, key, value, road);
        return Reflect.set(this.active, key, value, this.active);
      },
    });
  }

  /** Install only after trusted play and continuation succeed; leaving restores every prior callback descriptor. */
  bind(equipment: EquipmentService, entry: Scope): void {
    if (entry.disposed || this.active !== this.road || equipment === this.road) throw new Error('Equipment entry is not available');
    const prior = [...callbacks].map(key => [key, Object.getOwnPropertyDescriptor(equipment, key)] as const);
    if (prior.some(([, descriptor]) => descriptor?.configurable === false)) throw new Error('Equipment callbacks are not configurable');
    for (const [key, descriptor] of prior) {
      const authored: unknown = Reflect.get(equipment, key, equipment);
      Object.defineProperty(equipment, key, { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? true,
        value: (...args: unknown[]) => {
          if (entry.disposed) return;
          if (typeof authored === 'function') Reflect.apply(authored, equipment, args);
          const page: unknown = Reflect.get(this.road, key, this.road);
          if (typeof page === 'function') Reflect.apply(page, this.road, args);
        } });
    }
    this.active = equipment;
    entry.onDispose(() => {
      this.active = this.road;
      for (const [key, descriptor] of prior) {
        if (descriptor === undefined) Reflect.deleteProperty(equipment, key); else Object.defineProperty(equipment, key, descriptor);
      }
      this.road.adsHeld = false; this.road.altHeld = false;
    });
  }
}
