import { appendFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { coldOrigin, WebDriverError } from './safari.mjs';

export const stairKinds = ['arraybuffer', 'texrgba', 'texcomp', 'glbuffer', 'canvas2d'];

/** @param {import('./safari.mjs').Safari} driver @param {{base:string,kind:string,log:string}} options */
export async function stairs(driver, { base, kind, log }) {
  const page = new URL('/memory-calibration.html', base);
  page.search = new URLSearchParams({ kind, stair: '1' }).toString();
  const startedAt = Date.now();
  let last = null;
  try {
    // a game service worker left by a zone boot answers the calibration URL with the game (device-2026-11-19 step 4)
    await coldOrigin(driver, base);
    await driver.navigate(page.href);
    const until = startedAt + 210_000;
    while (Date.now() < until) {
      const step = await driver.evaluate(`
        return {step:window.__calib ?? null, timeOrigin:performance.timeOrigin, visible:document.visibilityState === 'visible'};
      `);
      if (last !== null && step.timeOrigin !== last.timeOrigin) return { kind, startedAt, last, outcome: 'page-reloaded' };
      if (!step.visible) throw new Error('PHONE LOCKED: calibration page is hidden');
      // the inspector's navigation returns once the document is interactive, before the page script sets __calib
      if (step.step === null && Date.now() - startedAt < 20_000) { await pause(350); continue; }
      if (step.step === null) throw new Error('memory-calibration.html did not expose the EM9 staircase');
      if (step.step.got !== last?.step.got || step.step.done || step.step.error) {
        appendFileSync(log, `${JSON.stringify({ ...step, at: Date.now() })}\n`);
        last = step;
      }
      if (step.step.done || step.step.error) return { kind, startedAt, last, outcome: step.step.error ? 'page-error' : 'done' };
      await pause(350);
    }
    return { kind, startedAt, last, outcome: 'timeout' };
  } catch (error) {
    if (!(error instanceof WebDriverError)) throw error;
    return { kind, startedAt, last, outcome: 'driver-error', driverCode: error.code, message: error.message };
  }
}
