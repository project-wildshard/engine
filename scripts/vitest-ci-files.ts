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
    'test/engine-rule-successors.test.ts',
    'test/engine-rule-successors-titan.test.ts',
  ],
  'network-rewards': [
    'test/net-fuzz.test.ts',
    'test/pine-rewards.test.ts',
    // MP1C.4: a real crossing on the real clock, then a reboot; kept off sibling workers like net-fuzz's crossing.
    'test/grid-crossing-crash.test.ts',
  ],
  'native-direct-worker': [
    'test/headless-direct-worker.test.ts',
    // Six real SDK workers, with a 20 s parent fence that scales with load (test/fixtures/loadBudget.ts): no sibling files.
    'test/headless-verb-tape-worker.test.ts',
  ],
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
  // QA 11-25 row 33: the publish file passed the 60 s file budget (66 s on main), so its budget refusal and its full store's
  // alarm each run in a file of their own, each with its own cold real cook and the same placement.
  'native-cook-publish-budget': ['test/cook-worker-publish-budget.test.ts'],
  'native-cook-publish-full': ['test/cook-worker-publish-full.test.ts'],
  // The stale preparation's worker case (J262) cooks three times in the worker's bounded child: split from
  // cook-stale-preparation.test.ts, which passed the 60 s file budget, it keeps the same no-neighbour placement.
  'native-cook-stale': ['test/cook-stale-preparation-worker.test.ts'],
  'native-cook-cpu': ['test/cook-cpu-limit.test.ts'],
  // SHARD-COMPAT C2: four cells and a road booted from server packs on two real workers, then a walker held at a gate and
  // walked home on the real clock; 136 s beside sibling workers on a 4-CPU runner (run 45124836499), so it runs alone.
  'native-pack-crossing': ['test/dedicated-pack-crossing.test.ts'],
  'driftwood-population': [
    'test/driftwood-headless-population.test.ts',
  ],
  'nalati-population': [
    'test/nalati-headless-population.test.ts',
    'test/nalati-headless-worker.test.ts',
  ],
  // The camp walk and fresh native worker replay share one child deadline.
  'nalati-ride': ['test/nalati-ride-verbs.test.ts'],
  'nalati-bot-taming': ['test/nalati-bot-taming.test.ts'],
  'nalati-taming': ['test/nalati-taming-verbs.test.ts'],
  // FAST-SLOW-TESTS FS4: the field taming's second leg (all five rounds from a saved breaking start), its own unit.
  'nalati-taming-rounds': ['test/nalati-taming-verbs-rounds.test.ts'],
  'nalati-awareness': ['test/nalati-awareness-verbs.test.ts'],
  // FAST-SLOW-TESTS FS5: the discovery tour's second leg, its own unit so the routes group keeps its size.
  'nalati-discovery-cave': ['test/nalati-discovery-verbs-cave.test.ts'],
  // FAST-SLOW-TESTS FS6: the entry leg leaves quarantine; in the routes group it would set the planner's floor (263 s).
  'nalati-discovery-entry': ['test/nalati-discovery-verbs.test.ts'],
  // TEST-SPEED TS5: the open plots run in three files and the Blender Template routes and Sunscar's observation in their
  // own, each its own unit, so no file passes 30 s hosted and the planner can spread them.
  'open-plots-headless': ['test/physics-open-plots-headless.test.ts'],
  'open-plots-headless-2': ['test/physics-open-plots-headless-2.test.ts'],
  'open-plots-headless-3': ['test/physics-open-plots-headless-3.test.ts'],
  'brasscap-mesa-routes': ['test/physics-brasscap-mesa-headless.test.ts'],
  'native-observation-sunscar': ['test/native-runtime-observation-sunscar.test.ts'],
  'standalone-grid': ['test/standalone-grid.test.ts', 'test/standalone-grid-lone.test.ts', 'test/standalone-grid-restore.test.ts'],
  'native-routes': [
    'test/physics-nalati-headless.test.ts',
    'test/native-runtime-observation.test.ts',
    'test/physics-headless.test.ts',
    'test/physics-shards-headless.test.ts',
  ],
  'stories-qara': [
    'test/pine-door-continuation.test.ts',
  ],
  'lease-order': [
    'test/mirror-lease-order-1.test.ts',
    'test/mirror-lease-order-2.test.ts',
    'test/mirror-lease-order-3.test.ts',
    'test/mirror-lease-order-4.test.ts',
  ],
} as const;
export const CI_SERIAL_TESTS = Object.values(CI_NATIVE_GROUPS).flat();
/** Real files whose before-collection admission also gets a serial nightly rehearsal. */
export const NATIVE_CONTENTION_SUITES = [
  'test/net-fuzz.test.ts', 'test/physics-nalati-headless.test.ts', 'test/physics-shards-headless.test.ts',
] as const;
// FS30: main CI already runs the two cold restore worlds without sibling workers.
export const NIGHTLY_SERIAL_TESTS = [...NATIVE_CONTENTION_SUITES, ...CI_NATIVE_GROUPS['native-restores']] as const;
/** Timing, uncapped encoding and load-sensitive cold native setup own the full
 * budget before collection. Split gates leave these files to hosted CI. */
export const CPU_EXCLUSIVE_TESTS = [
  'test/net-bots.test.ts', 'test/net-bots-driftwood.test.ts', 'test/cook-cpu-limit.test.ts',
  'test/layer-interest-grid.test.ts',
  ...NATIVE_CONTENTION_SUITES,
] as const;
