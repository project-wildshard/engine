import { expect, test } from 'vitest';
import { slugOfPath } from './slugPath';

/** SA36: the entry opens the slug page for exactly the paths pages/worker.ts serves it on (test/page-workers.test.ts). */
test('only /slug/<slug> names a slug', () => {
  expect(['/slug/driftwood-isle', '/slug/open-plot-thin-ice/', '/slug/_template'].map(slugOfPath)).toEqual(['driftwood-isle', 'open-plot-thin-ice', '_template']);
  expect(['/', '/slug/', '/slug/a/b', '/slugs/x', '/doctor/', '/slug/a%20b'].map(slugOfPath)).toEqual([null, null, null, null, null, null]);
});
