#!/usr/bin/env node
// MMO-SERVER MS2.4a: turn staging's signed release into the root-owned state
// that selects the cook checkout. cook.env deliberately contains credentials only.
import { createPublicKey, verify } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUILD = /^[0-9a-f]{40}$/u, TAG = /^server-staging-([0-9a-f]{40})$/u;
/** @param {string} text @param {string} name */
const value = (text, name) => [...text.matchAll(new RegExp(`^${name}=(.*)$`, 'gmu'))].pop()?.[1]?.trim().replaceAll(/^["']|["']$/gu, '') ?? '';
/** @param {string} name */
const argument = name => { const index = process.argv.indexOf(name), next = process.argv[index + 1]; if (index === -1 || next === undefined) throw new Error(`Missing ${name}`); return next; };

/** @param {string} text @param {string} key */
export function signedCookRelease(text, key) {
  const signed = JSON.parse(text);
  if (typeof signed?.body !== 'string' || typeof signed?.signature !== 'string' || !/^(?:[0-9a-f]{2})+$/u.test(signed.signature)) throw new Error('Invalid signed release');
  const publicKey = createPublicKey({ key: Buffer.from(key, 'hex'), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(signed.body), publicKey, Buffer.from(signed.signature, 'hex'))) throw new Error('A release file has a bad signature');
  const release = JSON.parse(signed.body), tag = typeof release?.bundle?.name === 'string' ? release.bundle.name.split('/')[0] : '';
  if (release?.channel !== 'staging' || typeof release.engineBuild !== 'string' || !BUILD.test(release.engineBuild) || !TAG.test(tag) || tag.slice('server-staging-'.length) !== release.engineBuild) throw new Error('The signed staging release has no matching server tag and build');
  return { tag, build: release.engineBuild };
}
/** @param {string} path @param {string} text */
function atomic(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
  const temporary = `${path}.${process.pid}.tmp`;
  try { writeFileSync(temporary, text, { mode: 0o600 }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
async function main() {
  const env = argument('--env'), state = argument('--state'), envText = readFileSync(env, 'utf8');
  const check = process.argv.includes('--check');
  const url = value(envText, 'RELEASE_URL'), key = value(envText, 'RELEASE_PUBLIC_KEY');
  if (!url.startsWith('https://') || key === '') throw new Error('staging.env has no HTTPS signed release configuration');
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`The signed staging release answered ${response.status}`);
  const next = signedCookRelease(await response.text(), key), text = `COOK_ENGINE_REF=${next.tag}\nWILDSHARD_BUILD=${next.build}\n`;
  if (check) { console.info('would'); return; }
  let held = ''; try { held = readFileSync(state, 'utf8'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (held === text) { console.info('unchanged'); return; }
  atomic(state, text); console.info('changed');
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
