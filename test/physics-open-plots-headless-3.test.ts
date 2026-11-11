import {physicsShardCases} from './fixtures/physicsShardCases';
import {beginCompiledProductSession} from './fixtures/headless/compiledProductSession';
import {OPEN_PLOTS_3} from './fixtures/openPlotGroups';

// OB2: each plot keeps one native resident through its entry and plaza walk.
// TEST-SPEED TS5: split from physics-open-plots-headless.test.ts by plot; the same resident and route bodies.
physicsShardCases(slug=>OPEN_PLOTS_3.has(slug),beginCompiledProductSession);
