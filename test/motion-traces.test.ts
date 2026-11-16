// @vitest-environment happy-dom
// J295: four balanced traces per file; the shared runner retains all eight
// original 40,000-tick traces, both replays and the unchanged hash baseline.
import { beforeAll, test } from 'vitest';
import { checkHostTrace, checkPageTrace, checkRidingTrace, loadTraceRapier } from './fixtures/motion-trace/traces';

beforeAll(loadTraceRapier);
test('the page trace: state, callbacks and camera', checkPageTrace, 240_000);
test('the riding trace: a real Mount through the step', checkRidingTrace, 240_000);
test.each(['legacy', 'versioned'])('the %s host trace: state, events and snapshot bytes', checkHostTrace, 240_000);
