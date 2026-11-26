// GitHub's decimal run IDs exceed the network fuzzer's unsigned 32-bit seed space.
import process from 'node:process';

const run = process.argv[2];
if (run === undefined || !/^\d+$/u.test(run)) throw new Error('Expected a decimal workflow run ID');
console.log(Number(BigInt(run) & 0xffff_ffffn));
