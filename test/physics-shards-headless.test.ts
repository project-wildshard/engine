import {physicsShardCases} from './fixtures/physicsShardCases';

// Keep every non-Nalati shard's ordered resident and route bodies unchanged.
// TEST-SPEED TS5: Blender Template's routes run in physics-brasscap-mesa-headless.test.ts, on its own resident as before.
physicsShardCases(slug=>slug!=='nalati-grasslands'&&slug!=='brasscap-mesa'&&!slug.startsWith('open-plot-'));
