#!/usr/bin/env node
// Every pinned shard file is on the pins release (the mirror `scripts/pins.ts` reads first), so one API blip never
// stops a pin install. Main red 45404606407 (2026-11-24): open-plot-thin-ice and open-plot-desert-ruin were pinned
// without a mirror copy, the API answered no for a moment, and `pins.ts install` threw.
//
//   node scripts/pins-mirror.mjs --check   list pins missing from the mirror; exit 1 if any
//   node scripts/pins-mirror.mjs --fill    upload each missing pin from the API (sha256-proved), then check
// `--fill` needs `gh` with contents:write on the engine repo (the pins-mirror workflow's token).
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentFetch } from './agent-requests.mjs';

const REPO = 'project-wildshard/engine';
const API = 'https://api.wildshard.io';

/** @param {{shards: readonly {slug: string, hash: string}[]}} pins @param {ReadonlySet<string>} assets */
export function missingPins(pins, assets) {
  return pins.shards.filter(pin => !assets.has(`${pin.hash}.tar`));
}

function mirrorAssets() {
  const out = execFileSync('gh', ['release', 'view', 'pins', '-R', REPO, '--json', 'assets', '-q', '.assets[].name'], { encoding: 'utf8' });
  return new Set(out.split('\n').filter(Boolean));
}

/** @param {string} url */
async function bytesOf(url) {
  for (let attempt = 1; ; attempt++) {
    const response = await agentFetch(url).catch(() => undefined);
    if (response?.ok === true) return new Uint8Array(await response.arrayBuffer());
    if (attempt === 3) throw new Error(`${url}: ${response?.status ?? 'no response'}`);
    await sleep(2000 * attempt);
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--fill') throw new Error('usage: pins-mirror.mjs --check | --fill');
  const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8'));
  let missing = missingPins(pins, mirrorAssets());
  if (mode === '--fill' && missing.length > 0) {
    const dir = join('tmp', 'pins-mirror');
    mkdirSync(dir, { recursive: true });
    try {
      for (const pin of missing) {
        const bytes = await bytesOf(`${API}/api/shardfiles/${pin.hash}`);
        if (createHash('sha256').update(bytes).digest('hex') !== pin.hash) throw new Error(`${pin.slug}: the API's bytes are not the pin ${pin.hash}`);
        const file = join(dir, `${pin.hash}.tar`);
        writeFileSync(file, bytes);
        execFileSync('gh', ['release', 'upload', 'pins', file, '-R', REPO], { stdio: 'inherit' });
        console.log(`mirrored ${pin.slug} ${pin.hash.slice(0, 8)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
    missing = missingPins(pins, mirrorAssets());
  }
  for (const pin of missing) console.log(`missing from the pins mirror: ${pin.slug} ${pin.hash}`);
  if (missing.length > 0) process.exitCode = 1;
  else console.log(`all ${pins.shards.length} pins are on the mirror`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
