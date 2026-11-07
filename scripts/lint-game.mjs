#!/usr/bin/env node
// The lifted tree's lint, by the size of the ask. With paths (the commit lane) it lints those files: 1 s instead of the
// whole tree's 11, which alone broke the 8 s budget. With none (`pnpm check`, CI) it lints the tree.
import { spawnSync } from 'node:child_process';

const TREE = ['src/client/engine', 'src/shared/engine', 'src/server/engine', 'src/client/game', 'src/shared/game', 'src/server/game', 'src/cook/game', 'src/client/host', 'src/shared/host', 'src/server/host', 'src/client/app', 'scripts', 'lint', 'vite'];
const LIFTED = new RegExp(`^(?:${TREE.join('|')})/`, 'u');
const asked = process.argv.slice(2);
const files = asked.filter(path => LIFTED.test(path));
if (asked.length > 0 && files.length === 0) process.exit(0);
const run = spawnSync('oxlint', ['-c', '.oxlintrc.json', '--deny-warnings', ...(asked.length === 0 ? TREE : files)], { stdio: 'inherit' });
if (run.error !== undefined) throw run.error;
process.exit(run.status ?? 1);
