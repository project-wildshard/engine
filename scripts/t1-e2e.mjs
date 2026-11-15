#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve as resolvePath } from 'node:path';

const listener = createServer();
await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', () => resolve(undefined)); });
const address = listener.address();
if (address === null || typeof address === 'string') throw new Error('Missing T1 port');
await new Promise((resolve, reject) => { listener.close(error => error ? reject(error) : resolve(undefined)); });
const out = resolvePath(process.env.WS_T1_BUILD_DIR ?? `tmp/${process.env.WS_LANE_NAME ?? 't1-e2e'}/t1/client`);
const browserTemp = resolvePath(`tmp/${process.env.WS_LANE_NAME ?? 't1-e2e'}/t1/browser-tmp`);
mkdirSync(browserTemp, { recursive: true });
const env = { ...process.env, TMPDIR: browserTemp, WS_T1_PORT: String(address.port), WS_T1_BUILD_DIR: out };
const commands = process.env.WS_T1_BUILD_DIR === undefined ? [
  ['pnpm', 'pins'], ['pnpm', 'gen:inputs'], ['python3', 'scripts/heavy-lane.py', 'build', '--', 'node', 'scripts/build-app.mjs', '--outDir', out],
] : [];
commands.push(['pnpm', 'exec', 'playwright', 'test', '--config', 'src/e2e/t1/playwright.config.ts', ...process.argv.slice(2)]);
for (const [command, ...args] of commands) {
  const run = spawnSync(command, args, { stdio: 'inherit', env });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
