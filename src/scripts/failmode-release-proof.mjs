// FM7 explicit native producer/WebCrypto proof; no game session and no external calls.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { signCodeRetention } from './code-retention.mjs';

await import('./bake-loader.mjs');
const { readSignedCodeRetention } = await import('../client/host/online/codeRetention.ts');
const { codeAvailability, retirementDeadline } = await import('../shared/host/codeRetention.ts');
const base = resolve('tmp/codex-pagesize'); mkdirSync(base, { recursive: true });
const work = mkdtempSync(join(base, 'release-proof-'));
try {
  const pair = generateKeyPairSync('ed25519'), current = 'a'.repeat(40), old = 'b'.repeat(40);
  const publicKey = pair.publicKey.export({type:'spki',format:'der'}).toString('hex');
  const privateKey = pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  mkdirSync(join(work, 'b', current), { recursive: true });
  writeFileSync(join(work, 'b', current, 'entry.js'), 'x');
  writeFileSync(join(work, 'version.json'), JSON.stringify({build:current}));
  writeFileSync(join(work, 'deploy-chunks.json'), JSON.stringify({format:2,builds:[{build:current,content:true,files:[{path:`b/${current}/entry.js`,bytes:1}]}]}));
  const signed = signCodeRetention({directory:work,channel:'staging',privateKey,publicKey});
  const expected = {channel:/** @type {const} */ ('staging'),engineBuild:current};
  const metadata = await readSignedCodeRetention(signed,publicKey,expected);
  assert.equal(codeAvailability(metadata,current),'kept');
  assert.equal(codeAvailability(metadata,old),'retired');
  assert.equal(codeAvailability(null,current),'unknown');
  assert.equal(retirementDeadline(metadata),null);
  const tampered=JSON.parse(signed);tampered.body=tampered.body.replace(current,old);
  await assert.rejects(readSignedCodeRetention(JSON.stringify(tampered),publicKey,expected));
  await assert.rejects(readSignedCodeRetention(signed,publicKey,{...expected,engineBuild:old}));
  console.log('PASS actual producer + WebCrypto reader: kept/excluded/legacy, unknown deadline, tamper and stale-build refusal; no wire changes');
} finally { rmSync(work,{recursive:true,force:true}); }
