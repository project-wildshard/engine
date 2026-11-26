// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its temporary build outputs under ./tmp.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths under ./tmp.
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { codeDirectory } from '../src/scripts/app-build/buildIdentity.mjs';
import { KEEP_PROMOTED, carryPreviousDeploy } from '../src/scripts/app-build/previousDeploy.mjs';
import { staleChunkFailure } from '../src/client/engine/boot/chunkRecovery';
import { createOldTabHandler } from '../src/client/engine/boot/oldTab';

// Fix-preview PV10: each Worker version carries the code of the builds before it, so an open tab finds its own code.
// KEEP_PROMOTED = 5 is this build and four before it: about 5 hours of hourly preview deploys, days of staging and
// production. A tab older than that gets PV11's card, and PV12 ends every tab at 24 hours.
const VERSION = '0.1.97';
const chunk = (build: string): string => `${codeDirectory(build, VERSION)}/late-${build.repeat(8)}.js`;

test('PV10: deploying A to F leaves F holding B to E\'s code and not A\'s; an A tab gets the card, a B tab loads its chunks', async () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/carry-builds-'));
  const deploy = async (build: string, previous?: string): Promise<string> => {
    const dir = join(root, build); mkdirSync(join(dir, codeDirectory(build, VERSION)), { recursive: true }); mkdirSync(join(dir, 'builds/shared'), { recursive: true });
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ build, clientVersion: VERSION }));
    writeFileSync(join(dir, `${codeDirectory(build, VERSION)}/main-${build.repeat(8)}.js`), `import("/${chunk(build)}");`);
    writeFileSync(join(dir, chunk(build)), `export const build = "${build}";`);
    writeFileSync(join(dir, `builds/shared/three-SHARED01.js`), 'export const three = 1;');
    await carryPreviousDeploy(dir, previous === undefined ? {} : { previousDirectory: previous });
    return dir;
  };
  try {
    let previous: string | undefined;
    for (const build of ['a', 'b', 'c', 'd', 'e', 'f']) previous = await deploy(build, previous);
    const f = join(root, 'f');
    expect(KEEP_PROMOTED).toBe(5);
    const graph = JSON.parse(readFileSync(join(f, 'deploy-chunks.json'), 'utf8')) as { builds: { build: string }[] };
    expect(graph.builds.map(row => row.build)).toEqual(['f', 'e', 'd', 'c', 'b']);
    for (const build of ['b', 'c', 'd', 'e', 'f']) expect(existsSync(join(f, chunk(build))), build).toBe(true);
    expect(existsSync(join(f, chunk('a')))).toBe(false);

    // The served page is F's dist: a B tab's lazy chunk is there; an A tab's is a 404, and /version.json names f.
    const served = (path: string): boolean => existsSync(join(f, path));
    expect(served(chunk('b'))).toBe(true);
    const missA = new TypeError(`Failed to fetch dynamically imported module: https://preview.test/${chunk('a')}`);
    expect(served(chunk('a'))).toBe(false);
    expect(staleChunkFailure(missA, 'https://preview.test/')).toBe(true);
    const shown: string[] = [], reload = vi.fn();
    const missed = createOldTabHandler({ build: 'a', show: card => { shown.push(card); }, capture: () => undefined, claim: () => true, reload });
    expect(missed('code', `/${chunk('a')}`)).toBe('reload');
    expect(shown).toEqual(['old-tab-updated']);
    expect(reload).toHaveBeenCalledOnce();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
