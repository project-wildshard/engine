import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

/** Authored SF59 graph JSON (a shard's data/lookGraphs.json section) read as typed graphs; throws on the first refusal. */
export function authoredGraphs(json: Readonly<Record<string, unknown>>): Readonly<Record<string, GraphIr>> {
  return Object.fromEntries(Object.entries(json).map(([id, raw]) => {
    const checked = validateGraph(raw, { trustedBudget: true });
    if (!checked.ok) throw new Error(`${id}: ${checked.errors.join('; ')}`);
    return [id, checked.graph];
  }));
}
