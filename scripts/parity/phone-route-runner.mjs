#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The fallback is permitted only when the runner has no available iOS runtime.
 * @param {unknown} inventory @returns {'simulator'|'webkit'} */
export function phoneEngine(inventory) {
  if (typeof inventory !== 'object' || inventory === null || !('runtimes' in inventory) || !Array.isArray(inventory.runtimes)) throw new Error('Invalid Simulator runtime inventory');
  return inventory.runtimes.some((/** @type {unknown} */ row) => typeof row === 'object' && row !== null && 'isAvailable' in row && row.isAvailable === true && 'identifier' in row && typeof row.identifier === 'string' && row.identifier.includes('.iOS-')) ? 'simulator' : 'webkit';
}

/** @param {string} out */
function inventoriedPhoneEngine(out) {
  const result = spawnSync('xcrun', ['simctl','list','runtimes','-j'], {encoding:'utf8'});
  // A missing simctl/Xcode is the documented no-Simulator runner, not a failed boot.
  if (result.status !== 0 && result.error?.message.includes('ENOENT') !== true && !/unable to find utility|not a developer tool|requires Xcode/iu.test(result.stderr ?? '')) throw new Error(`Simulator inventory failed: ${result.stderr}`);
  const inventory = result.status === 0 ? /** @type {unknown} */ (JSON.parse(result.stdout)) : {runtimes:[]};
  const engine = phoneEngine(inventory);
  writeFileSync(resolve(out,'engine.json'), JSON.stringify({engine,inventory,simctlStatus:result.status,simctlError:result.stderr,error:result.error?.message??null}));
  return engine;
}

function main() {
  if (process.argv.includes('--wait-for-prepare') || process.argv.includes('--prepare-simulator'))
    throw new Error('CI phone preparation was retired by G989; run the local route through sim-lane');
  const out = resolve('boot-smoke-results/phone-route'); mkdirSync(out,{recursive:true});
  const engine = inventoriedPhoneEngine(out);
  if (process.argv.includes('--select-engine')) { console.log(`engine=${engine}`); return; }
  const started = performance.now();
  const route = process.argv.find(arg => arg.startsWith('--route=')) ?? '--route=entry';
  const args = ['node','scripts/parity/phone-route.mjs',`--engine=${engine}`,`--sha=${process.env.TESTED_SHA??''}`,route];
  const command = engine === 'simulator' ? 'scripts/sim-lane.sh' : 'scripts/browser-lane.sh';
  const child = spawnSync(command, engine === 'simulator' ? ['run','--max','15','wildshard-iphone',...args] : ['--max','15',...args], {stdio:'inherit'});
  writeFileSync(resolve(out,'leg-timing.json'), JSON.stringify({engine, preparation:null,route,wallMs:performance.now()-started,status:child.status}));
  process.exitCode = child.status ?? 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
