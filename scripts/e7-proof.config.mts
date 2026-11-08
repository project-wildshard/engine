import {defineConfig} from 'vitest/config';
import base from '../vitest.config.ts';

// Explicit outer-edge proofs stay outside the normal hook inventory.
export default defineConfig({
  ...base,
  test:{...base.test,projects:undefined,environment:'node',
    include:['test/e7-owned-effects.proof.ts'],exclude:['**/node_modules/**']},
});
