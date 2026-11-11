import {physicsShardCases} from './fixtures/physicsShardCases';

// Keep every non-Nalati shard's ordered resident and route bodies unchanged.
// TEST-SPEED TS5: Blender Template's routes run in physics-blender-template-headless.test.ts, on its own resident as before.
physicsShardCases(slug=>slug!=='nalati-grasslands'&&slug!=='blender-template'&&!slug.startsWith('open-plot-'));
