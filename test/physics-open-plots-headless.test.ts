import {physicsShardCases} from './fixtures/physicsShardCases';

// OB2: each plot keeps one native resident through its entry and plaza walk.
physicsShardCases(slug=>slug.startsWith('open-plot-'));
