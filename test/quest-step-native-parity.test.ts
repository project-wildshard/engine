import { afterAll } from 'vitest';
import { cachedDriftwoodWitness as driftwoodWitness, retireDriftwoodWitness } from './fixtures/driftwood-witness-cache';
import { nativeQuestParity } from './fixtures/native-quest-parity';

// Preserve regenerate-before-replay order within this shard's worker.
nativeQuestParity('driftwood-isle', mode => driftwoodWitness(mode, 270_000));

afterAll(retireDriftwoodWitness);
