// Explicit outer-edge proof; never added to a local git hook or normal test glob.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as v from 'valibot';

const root=process.cwd(),directory=resolvePath(process.argv[2]??'tmp/e7-records-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),config=join(work,'vitest.config.mjs'),report=join(work,'results.json');
try{
 writeFileSync(config,`import base from ${JSON.stringify(pathToFileURL(join(root,'vitest.config.ts')).href)};import{withTestEnvironments}from ${JSON.stringify(pathToFileURL(join(root,'scripts/vitest-environments.ts')).href)};export default withTestEnvironments({...base,test:{...base.test,include:['test/e7-records.proof.ts']}});`);
 const result=spawnSync(process.execPath,['scripts/vitest-tmp.ts','run','--config',config,'test/e7-records.proof.ts','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile=${report}`],{env:{...process.env,WS_E7_PROOF_DIR:work},stdio:'inherit'});
 assert.equal(result.status,0,'Real E7 wire/file/table proof must pass');
 const receipt=v.parse(v.object({numTotalTests:v.number(),numPassedTests:v.number(),numPendingTests:v.number()}),JSON.parse(readFileSync(report,'utf8')));
 assert.equal(receipt.numTotalTests,2);assert.equal(receipt.numPassedTests,2);assert.equal(receipt.numPendingTests,0,'Missing products or skipped proofs are not green');
}finally{rmSync(work,{recursive:true,force:true});}
