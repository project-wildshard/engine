// After recording an actual CI21.H landing in the policy, derive its dates.
// Commit the receipt and these dates together; readLiftPending checks history.
import {readFileSync,writeFileSync} from 'node:fs';
import {dateLiftBatches} from './lift-pending-batches.mjs';

const path='test/lift-pending-policy.json';
/** @type {{batchSchedule:unknown}} */const policy=JSON.parse(readFileSync(path,'utf8'));
policy.batchSchedule=dateLiftBatches(policy.batchSchedule);
writeFileSync(path,`${JSON.stringify(policy,null,2)}\n`);
console.log('Derived CI21 batch dates from the recorded enabler landings; commit and validate with node scripts/lift-pending.mjs.');
