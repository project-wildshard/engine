import { engineString } from '../../../shared/engine/strings';
import { app } from '../app/runtime';
import { frameProbe } from '../core/tier';
import { sendNote } from '../ui/review';
import { mountUi } from '../ui/ownership';
import { runCalibration, type CalibrationRun, type CalibrationMeasurements } from './run';
import type { CalibrationScript } from './wasm';
import type { Scope } from '../../../shared/engine/app/scope';

declare const __BUILD_ID__: string;
/** Run the standalone browser calibration without installing a playable level or a Developer tool; `scripts` hands in
 *  the shipped decision modules (as data) for the Wasm boundary's real-script rows. */
export async function enterCalibration(scripts: (owner: Scope) => Promise<readonly CalibrationScript[]> = () => Promise.resolve([])): Promise<void> {
  app.setState('capture'); frameProbe.uncapped = true;
  // No level is loaded, hence no gameplay/render systems can run beside the synthetic scene.
  if (Object.values(app.systemsByPhase()).some((systems) => systems.length > 0)) throw new Error('Calibration capture must have no level systems');
  document.querySelector('#game')?.remove(); document.querySelector('#hud')?.remove(); document.querySelector('.ws-title-shell')?.remove(); document.querySelector('.ws-load')?.remove();
  const status = document.createElement('pre'); status.textContent = engineString('s_e6539473d9a0'); mountUi(status, app.engineScope, document.body);
  const handle = { status: 'starting', result: null as CalibrationRun | null, error: null as string | null, inbox: 'pending', measurements: undefined as CalibrationMeasurements | undefined };
  window.__calibration = handle;
  try {
    const modules = await scripts(app.engineScope);
    handle.result = await runCalibration((text) => { handle.status = text; status.textContent = text; }, (samples) => { handle.measurements = samples; }, modules);
    const sent = await sendNote({ category: 'perf', note: JSON.stringify(handle.result), context: { build: __BUILD_ID__, source: 'calibration', assumption: handle.result.phone.assumption }, screenshot: null });
    handle.inbox = typeof sent === 'string' ? sent : `sent:${sent.id}`;
    handle.status = 'done'; status.textContent = engineString('s_f38033e30ec2', [handle.inbox]);
  } catch (error) { handle.error = error instanceof Error ? `${error.stack ?? error.message}${error.cause instanceof Error ? `\nCaused by: ${error.cause.stack ?? error.cause.message}` : ''}` : String(error); handle.status = 'error'; status.textContent = handle.error; }
  finally { frameProbe.uncapped = false; }
}
