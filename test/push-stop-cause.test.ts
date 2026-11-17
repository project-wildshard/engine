// oxlint-disable-next-line import/no-nodejs-modules -- Real process groups, a real CPU broker and real signals.
import { spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The owner fixture and the broker's private scheduler root.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { parallelChecks } from '../.githooks/push-checks.mjs';
import { prePushCause } from '../scripts/land.mjs';
import { gateReport, printGateReport } from '../scripts/gate-report.mjs';

test('local gate keeps a JSON report and names assertion and setup failures', () => {
  mkdirSync('tmp', { recursive: true });
  const work = mkdtempSync(resolve('tmp/gate-report-'));
  try {
    const path = gateReport({ WS_LOCAL_LAND_HEAD: 'a'.repeat(40), WS_LANE_NAME: 'fixture' }, work);
    if (path === undefined) throw new Error('Local gate produced no report path');
    expect(path).toMatch(/tmp\/fixture\/vitest-.+\.json$/u);
    writeFileSync(path, JSON.stringify({ testResults: [
      { name: join(work, 'test/assert.test.ts'), assertionResults: [{ status: 'failed', fullName: 'real assertion' }] },
      { name: join(work, 'test/setup.test.ts'), status: 'failed', assertionResults: [] },
    ] }));
    const lines: string[] = [];
    printGateReport(path, work, line => { lines.push(line); });
    expect(lines.join('\n')).toContain('test/assert.test.ts');
    expect(lines.join('\n')).toContain('test/setup.test.ts');
    expect(lines.join('\n')).toContain(path);
    expect(readFileSync(path, 'utf8')).toContain('real assertion');
    printGateReport(join(work, 'missing.json'), work, line => { lines.push(line); });
    expect(lines.at(-1)).toContain('missing or unreadable');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

// CPU-BROKER (2026-11-16): a red check:saves made the gate stop every other task, the vitest run and its CPU broker
// among them. The run then printed "CPU broker exited before its owner" as if the broker were the fault, and the push
// was skipped past (SKIP_CHECK) instead of fixed. A stopped task now says so, and an owner that is itself stopped
// expects its broker's exit.

afterEach(() => { vi.restoreAllMocks(); });

test('the first failure is the only RED; a task it stopped names it', async () => {
  const lines: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((line: string) => { lines.push(line); });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const result = await parallelChecks([
    { name: 'vitest (full)', commands: [[process.execPath, '-e', 'setInterval(() => {}, 1000)']] },
    { name: 'check:saves', commands: [[process.execPath, '-e', 'setTimeout(() => process.exit(1), 200)']] },
  ], { graceMs: 2000 });
  expect(result.ok).toBe(false);
  expect(result.results.find(row => row.name === 'check:saves')).toMatchObject({ code: 1 });
  expect(result.results.find(row => row.name === 'check:saves')).not.toHaveProperty('stoppedBy');
  expect(result.results.find(row => row.name === 'vitest (full)')?.stoppedBy).toBe('check:saves failed');
  expect(lines.filter(line => line.includes('RED'))).toEqual([expect.stringMatching(/^ {2}- check:saves RED in /u)]);
  expect(lines).toContainEqual(expect.stringMatching(/^ {2}- vitest \(full\) stopped in [\d.]+ s: check:saves failed$/u));
  // land's receipt names the real cause
  expect(prePushCause(lines.join('\n'))).toMatch(/^check:saves RED in /u);
}, 30_000);

/** An owner shaped like scripts/vitest-tmp.ts: its own broker, its signal handler, its loss handler. */
async function owner(work: string, kill: (pid: number, broker: number) => void): Promise<{ code: number | null; output: string }> {
  const file = join(work, 'owner.mjs');
  writeFileSync(file, `import {startCpuBroker} from ${JSON.stringify(resolve('scripts/cpu-broker.mjs'))};
const broker=await startCpuBroker({root:${JSON.stringify(join(work, 'cpu'))},capacity:1});
const stop=async()=>{await broker.close();process.exit(0);};
process.on('SIGTERM',()=>{broker.expectExit();void stop();});
broker.lost.catch(error=>{console.log('LOST '+error.message);process.exit(3);});
console.log('READY '+String(broker.pid));setInterval(()=>{},1000);`);
  const child = spawn(process.execPath, [file], { cwd: process.cwd(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', signalled = false;
  child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
  const exited = new Promise<number | null>(done => { child.once('close', code => { done(code); }); });
  await new Promise<void>((ready, fail) => {
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      const match = /READY (\d+)/u.exec(output);
      if (!signalled && match?.[1] !== undefined && child.pid !== undefined) { signalled = true; kill(child.pid, Number(match[1])); ready(); }
    });
    child.once('close', () => { fail(new Error(`owner ended before it was ready: ${output}`)); });
  });
  return { code: await exited, output };
}

test('a stopped run expects its broker to go; a broker lost on its own is still reported, with why', async () => {
  mkdirSync('tmp', { recursive: true });
  const work = mkdtempSync(resolve('tmp/push-stop-cause-'));
  try {
    // The gate's stop: SIGTERM to the run's whole process group, broker included.
    const stopped = await owner(work, pid => { process.kill(-pid, 'SIGTERM'); });
    expect(stopped.output).not.toContain('exited before its owner');
    expect(stopped.code).toBe(0);
    // Only the broker goes (a reclaim, a crash): the owner hears of it, and of the signal.
    const lost = await owner(work, (_pid, broker) => { process.kill(broker, 'SIGTERM'); });
    expect(lost.output).toMatch(/LOST CPU broker exited before its owner \(exit 0\): CPU broker: stopped by SIGTERM/u);
    expect(lost.code).toBe(3);
  } finally { rmSync(work, { recursive: true, force: true }); }
}, 60_000);
