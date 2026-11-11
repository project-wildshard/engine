/** Native integration keeps its original deadlines without sibling Vitest workers.
 * Groups run files sequentially; parallel discovery excludes their exact union. */
export const CI_NATIVE_GROUPS = {
  'room-performance': [
    'test/net-bots.test.ts',
  ],
  // TEST-SPEED TS5: Driftwood's 32-player tick proof, split from net-bots, is its own timing unit.
  'room-performance-driftwood': ['test/net-bots-driftwood.test.ts'],
  'escape-titan': [
    'test/tooling/parity/browser-escape.test.mjs',
    'test/nalati-titan-verbs.test.ts',
    'test/engine-rule-successors.test.ts',
    'test/engine-rule-successors-titan.test.ts',
  ],
  'network-rewards': [
    'test/net-fuzz.test.ts',
    'test/pine-rewards.test.ts',
  ],
  'native-direct-worker': ['test/headless-direct-worker.test.ts'],
  'native-host-transport': ['test/sim-transport.test.ts'],
  'native-restores': [
    'test/pinned-restore-play.test.ts',
  ],
  'native-cook': [
    'test/cook-worker.test.ts',
  ],
  // The publish file's cold real cook keeps the original serial, no-neighbour placement. The limits file
  // (hostile archives, job limits, R2) runs no real cook and stays an ordinary file, so the planner fits.
  'native-cook-publish': ['test/cook-worker-publish.test.ts'],
  'native-cook-cpu': ['test/cook-cpu-limit.test.ts'],
  'driftwood-population': [
    'test/driftwood-headless-population.test.ts',
  ],
  'nalati-population': [
    'test/nalati-headless-population.test.ts',
    'test/nalati-headless-worker.test.ts',
  ],
  'nalati-bot-taming': ['test/nalati-bot-taming.test.ts'],
  'nalati-taming': ['test/nalati-taming-verbs.test.ts'],
  // FAST-SLOW-TESTS FS4: the field taming's second leg (all five rounds from a saved breaking start), its own unit.
  'nalati-taming-rounds': ['test/nalati-taming-verbs-rounds.test.ts'],
  'nalati-awareness': ['test/nalati-awareness-verbs.test.ts'],
  // FAST-SLOW-TESTS FS5: the discovery tour's second leg, its own unit so the routes group keeps its size.
  'nalati-discovery-cave': ['test/nalati-discovery-verbs-cave.test.ts'],
  // FAST-SLOW-TESTS FS6: the entry leg leaves quarantine; in the routes group it would set the planner's floor (263 s).
  'nalati-discovery-entry': ['test/nalati-discovery-verbs.test.ts'],
  'driftwood-long-session': ['test/driftwood-long-session.test.ts'],
  // TEST-SPEED TS5: the open plots run in three files and the Blender Template routes and Sunscar's observation in their
  // own, each its own unit, so no file passes 30 s hosted and the planner can spread them.
  'open-plots-headless': ['test/physics-open-plots-headless.test.ts'],
  'open-plots-headless-2': ['test/physics-open-plots-headless-2.test.ts'],
  'open-plots-headless-3': ['test/physics-open-plots-headless-3.test.ts'],
  'blender-template-routes': ['test/physics-blender-template-headless.test.ts'],
  'native-observation-sunscar': ['test/native-runtime-observation-sunscar.test.ts'],
  'standalone-grid': ['test/standalone-grid.test.ts', 'test/standalone-grid-lone.test.ts', 'test/standalone-grid-restore.test.ts'],
  'native-routes': [
    'test/driftwood-optional-verbs.test.ts',
    'test/driftwood-trade-verbs.test.ts',
    'test/nalati-patrol-verbs.test.ts',
    'test/physics-nalati-headless.test.ts',
    'test/nalati-chapter-binding.test.ts',
    'test/native-runtime-observation.test.ts',
    'test/physics-headless.test.ts',
    'test/physics-shards-headless.test.ts',
  ],
  'stories-qara': [
    'test/pine-quest-verbs.test.ts',
    'test/pine-door-continuation.test.ts',
    'test/driftwood-story-verbs.test.ts',
    'test/sky-progression-verbs.test.ts',
    'test/nalati-qara-verbs.test.ts',
  ],
  'chapter-one': [
    'test/nalati-chapter-one.test.ts',
  ],
  'lease-order': [
    'test/mirror-lease-order-1.test.ts',
    'test/mirror-lease-order-2.test.ts',
    'test/mirror-lease-order-3.test.ts',
    'test/mirror-lease-order-4.test.ts',
  ],
} as const;
export const CI_SERIAL_TESTS = Object.values(CI_NATIVE_GROUPS).flat();
/** Timing and uncapped encoder proofs hold the whole CPU budget, so they run alone. */
export const CPU_EXCLUSIVE_TESTS = ['test/net-bots.test.ts', 'test/net-bots-driftwood.test.ts', 'test/cook-cpu-limit.test.ts'] as const;
