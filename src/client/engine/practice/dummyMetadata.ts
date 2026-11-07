import { engineString } from '../../../shared/engine/strings';
import type { DummyVariant } from './TrainingDummy';

/** The player's capsule is 1.8 m from feet to crown; keep the shared specimens human-sized. */
export const TRAINING_DUMMY_HEIGHT = 1.8;
export const TRAINING_DUMMY_SOURCE_HEIGHT = 2.65;
export const TRAINING_DUMMY_SCALE: number = TRAINING_DUMMY_HEIGHT / TRAINING_DUMMY_SOURCE_HEIGHT;
export const DUMMY_VARIANTS: readonly { id: DummyVariant; label: string; full: string }[] = [
  { id: 'wood', label: engineString('s_731140284eac'), full: 'Wood frame · wood armor' },
  { id: 'straw-cloth', label: engineString('s_689ddfcde9e2'), full: 'Straw body · cloth armor' },
  { id: 'wood-steel', label: engineString('s_305d2091e911'), full: 'Wood frame · steel armor' },
];
