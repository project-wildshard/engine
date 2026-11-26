import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real passive-observer CLI and kernel counters, without a push or network request.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep owned process fixtures inside the repository's test scratch.
import {resolve} from 'node:path';

const discovery={relativeAndAbsoluteRoots:true,wrapperExcluded:true,ambiguousRefused:true,missingBounded:true,legacySummaryRefused:true,actualCliDiscovery:true,identityMismatchRefused:true,timeoutEvidenceRetained:true,newbornRetried:true,newbornDeadlineRetained:true};

test('TS12a observes real owners without counting wrappers or hiding orphan writers',()=>{
 const report=JSON.parse(execFileSync('python3',['src/scripts/vitest-bench-observe-proof.py','--scratch',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','bench-observe-proof')],{encoding:'utf8',timeout:20000}));
 expect(report.discovery).toEqual(discovery);
 expect(report.normal.drained).toBe(true);
 expect(report.normal.exactTotalAbsent).toBe(true);
 expect(report.normal.sampledCpuLowerBound).toBeGreaterThan(report.normal.busyCpuIndependent*.6);
 expect(report.orphan).toEqual({orphanReported:true,writerNotSignalled:true});
},20000);

// The default proof already executes every ownership/refusal/orphan fact.
// Light release windows may still invoke the CLI with --case ownership.
