import {physicsShardCases} from './fixtures/physicsShardCases';

// Keep every non-Nalati shard's ordered resident and route bodies unchanged.
physicsShardCases(slug=>slug!=='nalati-grasslands'&&!slug.startsWith('open-plot-'));
