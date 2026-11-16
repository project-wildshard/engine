// @vitest-environment happy-dom
import { beforeAll, test } from 'vitest';
import { checkHostTrace, loadTraceRapier } from './fixtures/motion-trace/traces';

beforeAll(loadTraceRapier);
test.each(['wet', 'dry', 'driver', 'walking'])('the %s host trace: state, events and snapshot bytes', checkHostTrace, 240_000);
