import type { RuntimeCost } from '@wildshard/format/runtimeCost';

/** A measured runtime bound for fixture client-plan declarations (`{ kind: 'client-plan', cost, binds }`): LD9 retired the
 * copied-runtime `entry` arm, so a fixture that binds sections declares the compiled client plan with this cost. */
export const FIXTURE_RUNTIME_COST: RuntimeCost = { webContentMB: 500, glMB: 100, engineBaseMB: 300, rev: 'abcdef1234', device: 'Fixture', evidence: 'progress/memory/fixture.json' };
