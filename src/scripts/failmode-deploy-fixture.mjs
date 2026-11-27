// FM11 uses one compiled graph. A second document identity drives the rig's
// signed deploy and code-retirement transitions over the same executable bytes.
import { constants, cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeDirectory, engineVersionOf, sourceBuildId } from './app-build/buildIdentity.mjs';

/** @param {string} first @param {string} next */
export function nextFailmodeDeploy(first, next) {
  const version = JSON.parse(readFileSync(join(first, 'version.json'), 'utf8'));
  const build = version.build;
  if (typeof build !== 'string' || !/^[0-9a-f]{7,40}(?:-[a-z0-9]+)?$/u.test(build)) throw new Error('Missing fixture build identity');
  const at = Date.parse(version.time);
  if (!Number.isFinite(at)) throw new Error('Missing fixture build time');
  const nextAt = at + 1000;
  const nextBuild = sourceBuildId(build.slice(0, 7), nextAt), nextTime = new Date(nextAt).toISOString();
  const from = `globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};`;
  const to = `globalThis.__WS_BUILD_ID__=${JSON.stringify(nextBuild)};`;
  if (!readFileSync(join(first, 'index.html'), 'utf8').includes(from)) throw new Error('Fixture document stamp disagrees with version.json');
  cpSync(first, next, { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true, force: false, errorOnExist: true });
  for (const file of readdirSync(next, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.html')) continue;
    const path = join(file.parentPath, file.name), html = readFileSync(path, 'utf8');
    if (html.includes(from)) writeFileSync(path, html.replace(from, to)
      .replace(`globalThis.__WS_BUILT_AT__=${at};`, `globalThis.__WS_BUILT_AT__=${nextAt};`)
      .replace(`name="ws-built-at" content="${version.time}"`, `name="ws-built-at" content="${nextTime}"`));
  }
  // A page loads its online bundle from its build's folder (oneWayIn's onlineGate, Zone select, the worker client). Without
  // that folder under the second build's name, a page booted on it never goes online (meta QA 11-25 row 65: 10b's held tap).
  // PV9: builds/<engineVersion>/<build>/; a fixture from before it has b/<build>/.
  for (const [own, copy] of [[codeDirectory(build, version.clientVersion ?? engineVersionOf()), codeDirectory(nextBuild, version.clientVersion ?? engineVersionOf())], [`b/${build}`, `b/${nextBuild}`]]) {
    if (existsSync(join(next, own))) cpSync(join(next, own), join(next, copy), { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true, force: false, errorOnExist: true });
  }
  const assets = join(next, 'assets/spawn');
  for (const name of ['packs', 'server']) {
    const firstBook = join(assets, `${name}-${build}.json`);
    if (!existsSync(firstBook)) continue;
    const book = JSON.parse(readFileSync(firstBook, 'utf8'));
    if (book.build === build) book.build = nextBuild;
    writeFileSync(join(assets, `${name}-${nextBuild}.json`), JSON.stringify(book));
  }
  writeFileSync(join(next, 'version.json'), JSON.stringify({ ...version, build: nextBuild, time: nextTime }));
  return nextBuild;
}
