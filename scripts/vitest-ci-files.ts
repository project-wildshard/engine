/** Native integration keeps its original deadlines without sibling Vitest workers.
 * Groups run files sequentially; parallel discovery excludes their exact union. */
export const CI_NATIVE_GROUPS = {
  'room-performance': [
    'test/net-bots.test.ts',
  ],
  'escape-titan': [
    'test/tooling/parity/browser-escape.test.mjs',
    'test/nalati-titan-verbs.test.ts',
    'test/engine-rule-successors.test.ts',
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
  'native-cook-cpu': ['test/cook-cpu-limit.test.ts'],
  'driftwood-population': [
    'test/driftwood-headless-population.test.ts',
  ],
  'nalati-population': [
    'test/nalati-headless-population.test.ts',
  ],
  'nalati-bot-taming': ['test/nalati-bot-taming.test.ts'],
  'nalati-taming': ['test/nalati-taming-verbs.test.ts'],
  'nalati-awareness': ['test/nalati-awareness-verbs.test.ts'],
  'driftwood-long-session': ['test/driftwood-long-session.test.ts'],
  'open-plots-headless': ['test/physics-open-plots-headless.test.ts'],
  'standalone-grid': ['test/standalone-grid.test.ts'],
  'native-routes': [
    'test/driftwood-optional-verbs.test.ts',
    'test/driftwood-trade-verbs.test.ts',
    'test/nalati-patrol-verbs.test.ts',
    'test/physics-nalati-headless.test.ts',
    'test/nalati-chapter-binding.test.ts',
    'test/nalati-discovery-verbs.test.ts',
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
export const CPU_EXCLUSIVE_TESTS = ['test/net-bots.test.ts', 'test/cook-cpu-limit.test.ts'] as const;
