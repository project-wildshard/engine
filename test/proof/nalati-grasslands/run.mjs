// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
// Partial gameplay coverage remains a failed whole-shard compatibility result.
// oxlint-disable-next-line import/no-nodejs-modules -- Native proof mode and exit status are CLI results.
import process from 'node:process';
import { compatibilityProbe } from '../compatibility/fixture.ts';
import { nalatiNativeWitness, nalatiTamingNativeWitness } from './witness.ts';

const mode = process.argv.at(2) ?? 'all';
if (!['all', 'headless', 'replay', 'ledger', 'slice-replay', 'taming-replay'].includes(mode)) throw new Error('Unknown compatibility proof mode');
const ledger = mode === 'all' || mode === 'ledger' ? await compatibilityProbe('nalati-grasslands', 'boot/headlessModules.ts', 'ledger') : {};
const native = mode === 'ledger' ? {} : mode === 'taming-replay' ? await nalatiTamingNativeWitness()
  : await nalatiNativeWitness(mode !== 'headless', mode !== 'slice-replay');
console.info(JSON.stringify({ slug: 'nalati-grasslands', ...ledger, ...native }));
process.exitCode = 1;
