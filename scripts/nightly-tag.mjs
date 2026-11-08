#!/usr/bin/env node
// Optional promotion helper. The schedule never tags; J184 leaves promotion in charge.
// J167: require the downloaded exact-SHA green nightly verdict before any network/write.
// A commit that already has a version tag is left alone: an unchanged tree needs no second release.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {plan, read, requireGreen} from './nightly-model.ts';

/** @param {...string} args */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** The next tag after these, by version order.
 * @param {readonly string[]} tags @returns {string} */
export function nextTag(tags) {
  const versions = tags.flatMap((tag) => { const m = /^v(\d+)\.(\d+)\.(\d+)$/u.exec(tag); return m === null ? [] : [/** @type {[number, number, number]} */ ([Number(m[1]), Number(m[2]), Number(m[3])])]; });
  const [major, minor, patch] = versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).at(-1) ?? [0, 1, -1];
  return `v${major}.${minor}.${patch + 1}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = process.argv.find(arg => arg.startsWith('--report='))?.slice(9);
  if (report === undefined) throw new Error('J167: tag held; pass --report=<downloaded nightly verdict.json>');
  requireGreen(/** @type {import('./nightly-model.ts').Verdict} */ (read(report)), plan());
  git('fetch', '--tags', 'origin');
  if (git('tag', '--points-at', 'HEAD').split('\n').some((tag) => /^v\d/u.test(tag))) console.log('This commit is already tagged');
  else {
    const tag = nextTag(git('tag', '--list', 'v*').split('\n'));
    git('tag', tag);
    git('push', 'origin', tag);
    console.log(`Tagged ${tag}`);
  }
}
