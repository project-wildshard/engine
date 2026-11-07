#!/usr/bin/env node
// VITE_API_ORIGIN for the tools: the one value the build reads (src/client/engine/core/apiOrigin.ts), from the
// environment, else `.env.local`, which Vite reads too. Unset, the tools stay on the game's host.
//   node scripts/api-origin.mjs      print the origin
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GAME_HOST = 'https://wildshard-singleplayer.vercel.app';

/** A value from `root`'s `.env.local`, or null.
 * @param {string} key @param {string} [root] */
export function envLocal(key, root = process.cwd()) {
  try {
    for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
      const m = /^(?<k>[A-Z_]+)=(?<q>"?)(?<v>.*)\k<q>$/u.exec(line.trim());
      if (m?.groups?.k === key) return m.groups.v;
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

/** The value with no trailing slash, '' when it is unset.
 * @param {string} [root] */
export function apiOriginSet(root = process.cwd()) {
  return (process.env.VITE_API_ORIGIN ?? envLocal('VITE_API_ORIGIN', root) ?? '').trim().replace(/\/+$/u, '');
}

/** Where a tool calls: the value, else the game's host.
 * @param {string} [root] */
export function apiOrigin(root = process.cwd()) {
  const set = apiOriginSet(root);
  return set === '' ? GAME_HOST : set;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(apiOrigin());
