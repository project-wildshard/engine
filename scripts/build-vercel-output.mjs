#!/usr/bin/env node
// Package the already-tested dist and API functions. Vercel never runs pnpm build again.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const original = readFileSync('vercel.json');
const config = JSON.parse(original.toString());
try {
  writeFileSync('vercel.json', JSON.stringify({...config, buildCommand:'node scripts/check-devserver.mjs dist',
    installCommand:'true', outputDirectory:'dist'}));
  const result = spawnSync('vercel', ['build','--standalone','--prod','--scope','raynos-projects','--token',process.env.VERCEL_BUILD_TOKEN ?? ''], {stdio:'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { writeFileSync('vercel.json', original); }
