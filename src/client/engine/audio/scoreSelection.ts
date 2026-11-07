/** Scene conditions are pure declared comparisons over platform-supplied scalar fields. */
export interface ScoreCondition { field: string; op: 'equals' | 'not-equals' | 'greater'; value: number | boolean | string | null }
/** A score row yields an ordered slot/fallback chain; repeated slots preserve the old policy. */
export interface ScoreSelection { slots: readonly string[]; when: readonly ScoreCondition[] }
/** Select the same existing calm/tension/boss decks without advancing clocks, scheduling or drawing randomness. */
export function selectScoreSlots(rows: readonly ScoreSelection[], mode: 'first' | 'all', scene: Readonly<Record<string, number | boolean | string | null | undefined>>): readonly string[] {
  const slots: string[] = [];
  for (const row of rows) {
    if (!row.when.every((condition) => {
      const value = scene[condition.field];
      if (condition.op === 'equals') return value === condition.value;
      if (condition.op === 'not-equals') return value !== condition.value;
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
    })) continue;
    slots.push(...row.slots);
    if (mode === 'first') break;
  }
  return slots;
}
