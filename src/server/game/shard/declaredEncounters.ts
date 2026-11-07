import * as v from 'valibot';
import { EncountersSchema } from '@wildshard/format/encounters';
import { PhaseEncounter, type PhaseEncounterPorts, type PhaseEncounterSpec } from '@wildshard/engine/ai/phases';
import type { SimHost } from '@wildshard/engine/sim';
import type { DeclaredHudHandles } from '@wildshard/engine/ui/declared';

/** Bind the existing declared boss panel; headless hosts omit HUD handles without importing DOM/rendering. */
export function installDeclaredEncounters(sim: SimHost, rows: readonly PhaseEncounterSpec[], ports: (id: string) => Omit<PhaseEncounterPorts, 'presentation'>, hud?: Pick<DeclaredHudHandles, 'bosses'>, decisionOwned: ReadonlySet<string> = new Set()): ReadonlyMap<string, PhaseEncounter> {
  const result = new Map<string, PhaseEncounter>();
  const checked = v.parse(EncountersSchema, rows);
  for (const row of checked) {
    if (!sim.entities.has(row.entity) || sim.adapters.has(`encounter.${row.id}`)) throw new Error('Missing actor or already installed encounter');
    const panel = row.panel === null ? undefined : hud?.bosses.get(row.id);
    if (hud && row.panel !== null && !panel) throw new Error('Missing declared boss panel');
    if (panel && (panel.definition.name !== row.name || panel.definition.title !== row.title || panel.definition.retryTitle !== row.retry)) throw new Error('Boss panel and encounter labels differ');
  }
  for (const row of checked) {
    const panel = row.panel === null ? undefined : hud?.bosses.get(row.id);
    result.set(row.id, new PhaseEncounter(sim, row, { ...ports(row.id), ...(panel ? { presentation: panel.presentation } : {}) }, decisionOwned.has(row.id)));
  }
  return result;
}
