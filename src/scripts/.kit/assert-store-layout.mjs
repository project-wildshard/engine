// GVS G9 (J230): a hosted install must really use pnpm's global virtual store, as the consumers prove theirs.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const modules = JSON.parse(readFileSync('node_modules/.modules.yaml', 'utf8'));
assert.equal(typeof modules.storeDir, 'string');
assert.equal(typeof modules.virtualStoreDir, 'string');
const store = realpathSync(modules.storeDir);
const links = realpathSync(resolve('node_modules', modules.virtualStoreDir));
assert.equal(links, resolve(store, 'links'), 'The installer selected a checkout-local virtual store');
for (const name of ['valibot', 'three', '@wildshard/format', '@dimforge/rapier3d-simd']) {
  const slot = realpathSync(resolve('node_modules', name));
  assert.ok(slot.startsWith(links + sep), `${name} did not resolve into the registered store`);
  console.log(`global-store-slot ${JSON.stringify({ name, slot })}`);
}
console.log(`global-store-layout ${JSON.stringify({ store, links, runnerCi: process.env.CI })}`);
