// ONE-FORMAT OF31f5: Driftwood's and Pine's kept rows as their items sections declare them (Driftwood r9
// `src/generators/kept.ts`, Pine r11), for tests that hold no product. The engine itself names no kept item.
import type { KeptRow } from '../../src/shared/game/loot/Owned';

export const DRIFTWOOD_KEPT: readonly KeptRow[] = [
  { id: 'whetstone-1', kind: 'upgrade', label: 'Whetstone I', gauge: { name: 'sharpen', level: 1 } },
  { id: 'whetstone-2', kind: 'upgrade', label: 'Whetstone II', gauge: { name: 'sharpen', level: 2 } },
  { id: 'heart-1', kind: 'upgrade', label: 'Sturdy heart I', gauge: { name: 'hearts', level: 1 } },
  { id: 'heart-2', kind: 'upgrade', label: 'Sturdy heart II', gauge: { name: 'hearts', level: 2 } },
  { id: 'sea-chart', kind: 'upgrade', label: 'Sea chart' },
  { id: 'cape', kind: 'cosmetic', label: 'Sailcloth cape' },
  { id: 'captain-hat', kind: 'cosmetic', label: "Captain's hat" },
  { id: 'charm-1', kind: 'charm', label: 'Sea glass charm I', gauge: { name: 'charms', level: 1 } },
  { id: 'charm-2', kind: 'charm', label: 'Sea glass charm II', gauge: { name: 'charms', level: 2 } },
  { id: 'charm-3', kind: 'charm', label: 'Sea glass charm III', gauge: { name: 'charms', level: 3 } },
  { id: 'bear-claw', kind: 'trophy', label: 'Bear claw' },
  { id: 'boar-tusk', kind: 'trophy', label: 'Boar tusk' },
  { id: 'iron-sword', kind: 'gear', label: 'Iron sword' },
];
export const PINE_KEPT: readonly KeptRow[] = [
  { id: 'warden-longbow', kind: 'gear', label: "The Warden's Longbow" },
  { id: 'lever-rifle', kind: 'gear', label: 'Lever-action' },
];
