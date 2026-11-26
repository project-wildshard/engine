// Meta MINI-AUTONOMY MA6: `gh` for reads, on the reader App's quota instead of Jake's user quota. Land and main-watch
// already read through src/scripts/gh-limit.mjs; this is the same token for a lane's own polls (`gh run list`, `gh run
// view`, `gh api repos/...`), such as the forward fixer's (M2).
//   node src/scripts/gh-read.mjs run list -R project-wildshard/engine -b main -L 5
// The token is Actions, Checks and Contents read only: a write answers 403, so pushes, re-runs and dispatches stay on
// plain `gh`. Without the App key on this machine it is plain `gh`.
import {spawnSync} from 'node:child_process';
import {readerEnv} from './gh-limit.mjs';

const result=spawnSync('gh',process.argv.slice(2),{stdio:'inherit',env:readerEnv()});
if(result.error)process.stderr.write(`gh-read: ${result.error.message}\n`);
process.exitCode=result.status??1;
