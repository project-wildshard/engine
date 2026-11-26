/** Exact revision/source/index correspondence is required for every product. */
import type { CookedEntryFacts } from '../../shared/game/shardfile/outputDescriptor';

export function buildValidationReceipts(revision: string, directory?: string, entryExclusions?: (index: unknown, product: string) => CookedEntryFacts): unknown[];
