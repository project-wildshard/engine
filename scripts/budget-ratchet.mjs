// The legacy rollout ceilings budget-ceilings.mjs moves into manifest data are `<shard>.<tier>.<pose>.<metric>` keys of
// lint/ratchet.json's budgets; the other budgets there (J10's `js/*` chunk gzip ceilings) belong to their own checks and stay.
const ROLLOUT_KEY = /^[^./]+\.(?:phone|desktop)\.[^.]+\.[^.]+$/u;

/** The ratchet budgets left once the rollout ceilings move to manifest data, in their order. */
export function keptBudgets(budgets) {
  return Object.fromEntries(Object.entries(budgets ?? {}).filter(([key]) => !ROLLOUT_KEY.test(key)));
}
