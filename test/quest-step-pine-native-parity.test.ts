import { pineWitness } from './proof/pine-hollow/native';
import { nativeQuestParity } from './fixtures/native-quest-parity';

// Preserve regenerate-before-replay order within this shard's worker.
nativeQuestParity('pine-hollow', mode => pineWitness(mode, 270_000));
