/** WASM-HOST H0: every first-party product's shipped sim decision modules, as plain calibration rows (exact admitted
 *  bytes plus the IO dimensions of the first script that binds each), for the engine's standalone calibration page.
 *  Nothing here installs a level, a host or a binding; a product that ships no scripts is skipped, one that does not
 *  load is reported with its error. */
import type { Scope } from '@wildshard/engine/app/scope';
import type { CalibrationScript } from '@wildshard/engine/calibrate/wasm';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { catalogueDocument } from '../../../shared/game/grid/catalogueDocument';
import { loadFirstPartyProduct } from './runtimeProduct';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';

export async function calibrationScripts(owner: Scope): Promise<CalibrationScript[]> {
  const rows: CalibrationScript[] = [];
  for (const slug of catalogueDocument().placements.map(row => row.slug).sort()) {
    const product = await loadFirstPartyProduct(slug, owner).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
    const failed = (error: string): void => { rows.push({ product: slug, script: '', module: '', bytes: new Uint8Array(0), states: 0, params: 0, error }); };
    if (product instanceof Error) { failed(product.message); continue; }
    const descriptor = outputDescriptor(product.shardfile);
    if (descriptor === undefined) { failed('no admitted output descriptor'); continue; }
    if (!product.has('sim/scripts')) continue;
    const seen = new Set<string>();
    for (const script of parseDecisionScripts(product.section('sim/scripts'))) {
      const file = descriptor.index.files.find(item => item.kind === 'wasm' && item.path === script.module);
      if (seen.has(script.module) || file?.name === undefined) continue;
      seen.add(script.module);
      rows.push({ product: slug, script: script.id, module: script.module, bytes: await product.file(file.name), states: script.state.length, params: Object.keys(script.params).length });
    }
  }
  return rows;
}
