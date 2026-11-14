import {physicsShardCases} from './fixtures/physicsShardCases';
import {beginCompiledFolderSession} from './fixtures/headless/compiledFolderSession';
import {OPEN_PLOTS_2,OPEN_PLOTS_3} from './fixtures/openPlotGroups';

// OB2: each plot keeps one native resident through its entry and plaza walk.
// TEST-SPEED TS5: the plots in OPEN_PLOTS_2/3 run in physics-open-plots-headless-2/-3.test.ts; every other plot runs here.
physicsShardCases(slug=>slug.startsWith('open-plot-')&&!OPEN_PLOTS_2.has(slug)&&!OPEN_PLOTS_3.has(slug),beginCompiledFolderSession);
