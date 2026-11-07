// oxlint-disable-next-line import/no-nodejs-modules -- Native scenarios run from the repository root.
import { resolve } from 'node:path';
import { readBuiltShardfile } from '../../scripts/built-product.mjs';

/** Products come from CI's normal build or the matching immutable local cache, never a test build. */
export function builtProduct(name: string): string { return readBuiltShardfile(resolve('.'), name); }
