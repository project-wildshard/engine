// Plain Node grid admission and durable regional continuation of the actual shard through its declared trusted headless entry.
import { source, sourceAssets } from '../../fixtures/sunscar-source-program.ts';
import { proveTrustedGridReady } from '../compatibility/gridReady.mjs';

console.info(JSON.stringify(await proveTrustedGridReady(source, undefined, null, sourceAssets)));
