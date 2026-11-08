import { WeightedTable, type WeightedRow } from '@wildshard/engine/ai/weighted';

/** Every eligible row drops once. The receiving pack applies its own policy. */
const HARVEST: Readonly<Record<string, readonly WeightedRow<string, string>[]>> = {
  deer: [{ item: 'venison', weight: 1 }, { item: 'deer-hide', weight: 1 }, { item: 'antlers', weight: 1, when: v => /stag|ghost/.test(v) }],
  boar: [{ item: 'boar-meat', weight: 1 }, { item: 'boar-hide', weight: 1 }, { item: 'boar-tusk', weight: 1, when: v => v !== 'sow' }],
  elk: [{ item: 'elk-meat', weight: 1 }, { item: 'elk-hide', weight: 1 }, { item: 'antlers', weight: 1, when: v => /bull|imperial/.test(v) }],
  bear: [{ item: 'bear-pelt', weight: 1 }, { item: 'bear-claw', weight: 1 }],
  crab: [{ item: 'crab-meat', weight: 1 }, { item: 'crab-claw', weight: 1 }, { item: 'crab-shell', weight: 1, when: v => v === 'big' }],
  monkey: [{ item: 'coconut', weight: 1 }, { item: 'silver-fur', weight: 1, when: v => v === 'elder' }, { item: 'monkey-fur', weight: 1, when: v => v !== 'elder' }],
};
/** Shared harvest law; selection has no randomness and never mutates a pack. */
export function harvestDrops(kind: string, variant = ''): string[] {
  return new WeightedTable({ mode: 'each', rows: HARVEST[kind] ?? [] }).roll(variant, () => 0)
    .flatMap(drop => Array.from({ length: drop.count }, () => drop.item));
}
