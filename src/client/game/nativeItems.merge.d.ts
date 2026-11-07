import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';

type ItemReaction = { readonly kind: 'alarm' } | { readonly kind: 'stagger'; readonly actor: AnimalSim; readonly strength: number; readonly running: boolean };
declare module '@wildshard/engine/events/maps' {
  interface AskMap { 'item.reaction': readonly [ItemReaction, ItemReaction] }
}
