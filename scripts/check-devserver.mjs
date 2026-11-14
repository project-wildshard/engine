#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A production build's flag file says DEVSERVER is off and no bundle keeps an unsubstituted DEVSERVER define (the
 *  flag file is scripts/build-app.mjs's, from the build's mode; the bundle takes the mode from the __DEVSERVER__ define). */
export function assertProductionBuild(directory) {
  const version=resolve(directory,'version.json');
  if (existsSync(version) && JSON.parse(readFileSync(version,'utf8')).preparationOnly === true) throw new Error('Preparation-only preview cannot be released');
  const flags = JSON.parse(readFileSync(resolve(directory, 'build-flags.json'), 'utf8'));
  if (flags?.devserver !== false) throw new Error('Production build has DEVSERVER enabled or no false build flag');
  const walk = (path) => {
    for (const file of readdirSync(path, { withFileTypes: true })) {
      const full = resolve(path, file.name);
      if (file.isDirectory()) walk(full);
      else if (file.name.endsWith('.js')) {
        const code = readFileSync(full, 'utf8');
        if (code.includes('__DEVSERVER__') || code.includes('__PREPARATION_ONLY__')) throw new Error('Production bundle contains an unsubstituted DEVSERVER or PREPARATION_ONLY define');
        // SHARD-SOURCE AP5 (J347): the dev hook (src/client/game/devScene/hook.ts) and its server half are DEVSERVER-only.
        for (const marker of ['__wildshardDevHook', 'wildshardDevColliders', 'wildshardDevRestart', '__shardfileDevQuests']) if (code.includes(marker)) throw new Error(`Production bundle ${file.name} contains the dev hook (${marker})`);
      }
    }
  };
  walk(directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertProductionBuild(resolve(process.argv[2] ?? 'dist'));
  console.info('check-devserver: production flag is false and every DEVSERVER define is substituted');
}
