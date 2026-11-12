import type { AppIdentity } from '@wildshard/engine/app/identity';

/**
 * Wildshard, as the engine sees it (E405 E414): the values the saves, the tools and the first paint already use.
 * The save prefix and format, the file names and the two window handles are wire contracts: a player's progress and
 * every capture script depend on them, so they never change. src/client/app/identity.ts installs this before anything runs.
 */
export const WILDSHARD_IDENTITY: AppIdentity = {
  name: 'Wildshard',
  wordmark: 'Project <b>Wildshard</b>',
  tagline: 'A world that does not exist yet, arriving one chunk at a time.',
  savePrefix: 'wildshard.save.v2@1.',
  saveEpoch: 1,
  previousSavePrefix: 'wildshard.save.v2.',
  identityPrefix: 'wildshard.save.v2.',
  saveFormat: 'wildshard.save',
  fileSlug: 'wildshard',
  importPlayerDocument: async (document, player) => (await import('../../shared/game/saves')).rebindCreatureRewards(document, player),
  exposeProbe: (probe) => { window.__wildshard = probe; },
  harness: () => (typeof window === 'undefined' ? undefined : window.__wildshardHarness),
  // SENTRY-TRIAGE S1: the live hosts report too, each under its own Sentry environment.
  errorReportOrigins: ['https://play.wildshard.io', 'https://staging.wildshard.io', 'https://preview.wildshard.io'],
  errorReportEnvironments: {
    'https://play.wildshard.io': 'production',
    'https://staging.wildshard.io': 'staging',
    'https://preview.wildshard.io': 'preview',
  },
};
