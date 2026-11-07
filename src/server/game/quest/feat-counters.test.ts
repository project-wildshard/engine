import { expect, test } from 'vitest';
import { featOutcome, witnessSavedFeats, type FeatCounterRows } from '../../../shared/game/quest/featCounters';

/** persistence.ts's feat counters as they were inline before the extraction (witness, the load loop and outcome, verbatim) */
function inline(counterRows: FeatCounterRows, store: { counts: Record<string, number> }, facts: (fact: string, key: string) => void, log: string[]) {
  const savedCounts = { read: (): Record<string, number> => store.counts, write: (saved: Record<string, number>): void => { log.push(`write ${JSON.stringify(saved)}`); store.counts = saved; } };
  const witness = (feat: FeatCounterRows['feats'][number], total: number): void => {
    if (feat.fact === null) return;
    for (let n = 1; n <= Math.min(total, counterRows.maximum); n++) facts(feat.fact, `${counterRows.prefix}${feat.id}${counterRows.separator}${String(n)}`);
  };
  for (const feat of counterRows.feats) witness(feat, Math.min(feat.count, savedCounts.read()[feat.id] ?? 0));
  return (kind: 'event' | 'kill', name: string, variant?: string, total?: number): void => {
    const saved = savedCounts.read();
    for (const feat of counterRows.feats) {
      if (kind === 'event' ? feat.event !== name : feat.kind !== name || feat.variant !== undefined && feat.variant !== variant) continue;
      const before = saved[feat.id] ?? 0, after = Math.min(feat.count, total === undefined ? before + 1 : Math.max(before, total));
      if (after === before) continue;
      saved[feat.id] = after; savedCounts.write(saved); witness(feat, after);
    }
  };
}

test('the feat counters advance, save and witness exactly as the inline persistence did', () => {
  let seed = 5;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = <T>(list: readonly T[]): T => { const value = list[Math.floor(rnd() * list.length)]; if (value === undefined) throw new Error('empty'); return value; };
  const kinds = ['titan', 'wolf', 'boar'], variants = ['storm', 'grey', undefined], events = ['tie', 'ride', 'find'];
  for (let round = 0; round < 60; round++) {
    const feats: FeatCounterRows['feats'] = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_v, i) => {
      const variant = variants[Math.floor(rnd() * variants.length)], byEvent = rnd() < .4;
      return { id: `f${String(i)}`, count: 1 + Math.floor(rnd() * 8), fact: rnd() < .2 ? null : `fact.${String(i % 3)}`,
        ...(byEvent ? { event: pick(events) } : { kind: pick(kinds), ...(variant === undefined ? {} : { variant }) }) };
    });
    const rows: FeatCounterRows = { key: 'counts', prefix: 'feat:', separator: '#', maximum: 1 + Math.floor(rnd() * 6), feats };
    const initial: Record<string, number> = Object.fromEntries(rows.feats.filter(() => rnd() < .5).map(feat => [feat.id, Math.floor(rnd() * 10)]));
    const a = { counts: structuredClone(initial) }, b = { counts: structuredClone(initial) }, logA: string[] = [], logB: string[] = [];
    const outcomeA = inline(rows, a, (fact, key) => { logA.push(`${fact} ${key}`); }, logA);
    const ports = { read: (): Record<string, number> => b.counts, write: (saved: Record<string, number>): void => { logB.push(`write ${JSON.stringify(saved)}`); b.counts = saved; },
      fact: (fact: string, key: string): void => { logB.push(`${fact} ${key}`); } };
    witnessSavedFeats(rows, ports);
    for (let step = 0; step < 40; step++) {
      const kill = rnd() < .5, name = kill ? pick(kinds) : pick(events), variant = kill ? variants[Math.floor(rnd() * variants.length)] : undefined, total = !kill && rnd() < .3 ? Math.floor(rnd() * 10) : undefined;
      outcomeA(kill ? 'kill' : 'event', name, variant, total); featOutcome(rows, ports, kill ? 'kill' : 'event', name, variant, total);
      expect(b.counts).toEqual(a.counts);
    }
    expect(logB).toEqual(logA);
  }
});
