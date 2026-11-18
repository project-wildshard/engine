import { budgetTierLimits } from '@wildshard/format/budget-tiers';
import { runtimeTierIssues, UNNAMED_TIER } from '@wildshard/format/runtime-tier';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** Older runtime products use the format reader's unnamed-runtime tier. */
export function runtimeTierLimits(source: Pick<Shardfile, 'budgets'>): ReturnType<typeof budgetTierLimits> {
  return budgetTierLimits({ tier: source.budgets.tier ?? UNNAMED_TIER });
}

/** J424: reporting a tier overage does not reduce the runtime's real residency claim. */
export function reportRuntimeTier(source: Pick<Shardfile, 'runtime' | 'budgets' | 'identity'>): void {
  for (const issue of runtimeTierIssues(source)) {
    console.warn(`[shardfile] ${source.identity.slug} runtime claims ${issue.actual} bytes against its ${issue.limit}-byte tier (report only)`);
  }
}
