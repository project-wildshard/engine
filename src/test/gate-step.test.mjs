// Meta QA 11-26 row 29: a gate copy step (its install, its pins) that stalls fails within its limit, naming the step and
// its last output, and leaves nothing of its process group running; a step that ends is passed through.
import {spawnSync} from 'node:child_process';
import {describe, expect, test} from 'vitest';
import {gateStep, lastLines, stepLimit} from '../scripts/gate-step.mjs';

const alive = (/** @type {number} */ pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('gate-step', () => {
  test('a stalled step is stopped at its limit with its name and last output, its whole group with it', () => {
    // the stand-in `pins install`: says what it is doing, starts a helper in its group, then waits forever
    const script = "const {spawn}=require('node:child_process');console.log('nalati: reading the mirror');"
      + "const h=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('helper '+h.pid);setInterval(()=>{},1000);";
    const began = performance.now();
    let message = '';
    try { gateStep('pins', process.execPath, ['-e', script], {cwd: process.cwd(), limitSeconds: 1}); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    const seconds = (performance.now() - began) / 1000;
    expect(message).toMatch(/^gate step pins stuck: no exit after 1 s, stopped \(limit: WS_GATE_STEP_S\); last output: /u);
    expect(message).toContain('nalati: reading the mirror');
    expect(message).toContain('STUCK, no exit after 1 s');
    // its limit plus the TERM grace at most, never the minutes a stall used to take
    expect(seconds).toBeLessThan(8);
    const helper = Number(/helper (\d+)/u.exec(message)?.[1] ?? '0');
    expect(helper).toBeGreaterThan(0);
    expect(alive(helper)).toBe(false);
  }, 20_000);

  test('a step that ends returns its output; a failing one names its exit and last lines', () => {
    expect(gateStep('install', process.execPath, ['-e', "console.log('done')"], {cwd: process.cwd(), limitSeconds: 30})).toContain('done');
    expect(() => gateStep('install', process.execPath, ['-e', "console.error('a');console.error('ERR_PNPM_OFFLINE');process.exit(3)"], {cwd: process.cwd(), limitSeconds: 30}))
      .toThrow('gate step install exited 3: a | ERR_PNPM_OFFLINE');
  }, 20_000);

  test('limits: each step has its own default, WS_GATE_STEP_S sets every one; the CLI exits 124 when stuck', () => {
    expect(stepLimit('pins', {})).toBe(900);
    expect(stepLimit('install', {})).toBe(300);
    expect(stepLimit('anything', {})).toBe(600);
    expect(stepLimit('pins', {WS_GATE_STEP_S: '5'})).toBe(5);
    expect(lastLines('a\n\n b \nc\nd\n', 2)).toBe('c | d');
    const cli = spawnSync(process.execPath, ['src/scripts/gate-step.mjs', 'pins', '1', '--', process.execPath, '-e', 'setInterval(()=>{},1000)'], {encoding: 'utf8'});
    expect(cli.status).toBe(124);
  }, 20_000);
});
