import {physicsShardCases} from './fixtures/physicsShardCases';

// TEST-SPEED TS5: split from physics-shards-headless.test.ts by shard (that file was 40-45 s hosted).
// Blender Template keeps its one ordered resident and the same route bodies.
physicsShardCases(slug=>slug==='blender-template');
