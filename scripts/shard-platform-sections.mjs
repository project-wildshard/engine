import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {customSectionsZeroFailures} from './check-custom-sections-zero.mjs';

/** Z15: every canonical product must have zero private/custom JSON. */
export function customSectionFailures(root,measures) {
  const policy=JSON.parse(readFileSync(resolve(root,'lint/ratchet.json'),'utf8'));
  return customSectionsZeroFailures(policy.budgets??{},measures);
}
