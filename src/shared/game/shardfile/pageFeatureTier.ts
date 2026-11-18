import { budgetTierLimits } from '@wildshard/format/budget-tiers';
import { jsonDataHeapBytes, jsonDataNodes } from '@wildshard/format/json';
import type { Shardfile } from '@wildshard/format/shardSchema';

type PageProduct = Pick<Shardfile, 'runtime' | 'budgets'> & { readonly questHost?: Pick<NonNullable<Shardfile['questHost']>, 'page'> | null };

/** Charge the four declared feature families before allocating an entered page. */
export function pageFeatureBudget(source: PageProduct): { bytes: number; memoryBytes: number; cpuMicrosPerFrame: number } | undefined {
  const page = source.questHost?.page;
  if (source.runtime !== null || page === undefined || !('version' in page)) return undefined;
  const limit = budgetTierLimits(source.budgets);
  let bytes = 0, nodes = 0;
  for (const rows of [page.prompts, page.observations, page.actions, page.initial]) {
    const rowBytes = jsonDataHeapBytes(rows), rowNodes = jsonDataNodes(rows);
    if (rowBytes === undefined || rowNodes === undefined) throw new Error('Page feature rows require bounded JSON');
    bytes += rowBytes; nodes += rowNodes;
  }
  // Reserve one budget unit per bounded JSON node of feature work. The scope
  // meter accounts actual frame time once that page starts running.
  if (nodes > limit.cpuMicrosPerFrame) throw new Error(`Declared page needs ${nodes} feature operations against its tier limit of ${limit.cpuMicrosPerFrame}`);
  return { bytes, memoryBytes: limit.memoryBytes, cpuMicrosPerFrame: limit.cpuMicrosPerFrame };
}

export function reportPageFeatures(source: Shardfile): void {
  const budget = pageFeatureBudget(source);
  if (budget !== undefined && budget.bytes > budget.memoryBytes) {
    console.warn(`[shardfile] ${source.identity.slug} page features claim ${budget.bytes} bytes against its ${budget.memoryBytes}-byte tier (report only)`);
  }
}
