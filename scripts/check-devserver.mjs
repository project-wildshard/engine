#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A production build's flag file says DEVSERVER is off and no bundle keeps an unsubstituted DEVSERVER define (the
 *  flag file is scripts/build-app.mjs's, from the build's mode; the bundle takes the mode from the __DEVSERVER__ define). */
export function assertProductionBuild(directory) {
  const flags = JSON.parse(readFileSync(resolve(directory, 'build-flags.json'), 'utf8'));
  if (flags?.devserver !== false) throw new Error('Production build has DEVSERVER enabled or no false build flag');
  const walk = (path) => {
    for (const file of readdirSync(path, { withFileTypes: true })) {
      const full = resolve(path, file.name);
      if (file.isDirectory()) walk(full);
      else if (file.name.endsWith('.js')) {
        const code = readFileSync(full, 'utf8');
        if (code.includes('__DEVSERVER__')) throw new Error('Production bundle contains an unsubstituted DEVSERVER define');
      }
    }
  };
  walk(directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertProductionBuild(resolve(process.argv[2] ?? 'dist'));
  console.info('check-devserver: production flag is false and every DEVSERVER define is substituted');
}
