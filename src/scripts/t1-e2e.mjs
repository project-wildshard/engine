#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { childListener } from './rig-listeners.mjs';
import { resolve as resolvePath } from 'node:path';
import { scratchDir } from './.kit/scratch-dir.mjs';

const lane=process.env.WS_LANE_NAME??'t1-e2e';
const taskRoot=process.env.WS_T1_SCRATCH_ROOT??resolvePath(import.meta.dirname,'..', '..');
const scratch=scratchDir(lane,'Template 1 browser harness',{root:taskRoot,env:{...process.env,WS_LANE_NAME:lane}});

const out = resolvePath(process.env.WS_T1_BUILD_DIR ?? `${scratch}/t1/client`);
const suite=process.env.WS_T1_SHARD??'all';
const browserTemp = resolvePath(scratch,'t1/browser-tmp',suite);
mkdirSync(browserTemp, { recursive: true });
const env = { ...process.env, TMPDIR: browserTemp, WS_T1_BUILD_DIR: out, WILDSHARD_CATALOGUE: resolvePath('out/.ring-catalogue.json') };
const mode = process.env.WS_T1_EXPLORE === '1' ? 'explore' : 'preview';
const commands = process.env.WS_T1_BUILD_DIR === undefined ? [
  ['node', 'src/scripts/pins.ts', 'install', '--ring', '1'], ['pnpm', 'gen:inputs'], ['python3', 'src/scripts/heavy-lane.py', 'build', '--', 'node', 'src/scripts/build-app.mjs', '--mode', mode, '--outDir', out],
] : [];
for (const [command, ...args] of commands) {
  const run = spawnSync(command, args, { stdio: 'inherit', env });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

// Keep the actual listener alive throughout Playwright's run: never probe then rebind.
const preview = spawn(process.execPath, ['src/scripts/preview-server.mjs', '--outDir', out, '--port', '0', '--telemetry-dir', resolvePath(scratch, 't1/telemetry',suite)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env });
try {
  const port = await childListener(preview, 'preview-ready');
  const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config', 'src/e2e/t1/playwright.config.ts', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...env, WS_T1_PORT: String(port), WS_T1_PREVIEW_OWNED: '1' },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (preview.exitCode === null && preview.signalCode === null) {
    let forced = false;
    const ended = once(preview, 'exit'), deadline = setTimeout(() => { forced = true; preview.kill('SIGKILL'); }, 8000);
    preview.kill('SIGTERM');
    try { await ended; } finally { clearTimeout(deadline); }
    if (forced) { console.error('The owned T1 preview required SIGKILL'); process.exitCode = 1; }
  }
}
