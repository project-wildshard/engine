// FORMAT-PRUNE FP16: one pinned shard's hostless, planless and folded proofs (test/fixtures/nativeHostSections.ts holds them and
// the helpers). QA 11-25 row 33 split native-assembly-host-sections.test.ts per pinned shard to keep each file under 60 s.
import { foldedProof } from './fixtures/nativeHostSections';

foldedProof('nalati-grasslands');
