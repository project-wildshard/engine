import {expect, test, vi} from 'vitest';
import {createChunkRecovery, reloadIntoNewerBuild, staleChunkFailure} from './chunkRecovery';

const base = 'https://game.test/';
const missingJs = new TypeError('Failed to fetch dynamically imported module: https://game.test/assets/pageEntry-1234abcd.js');
const missingCss = new Error('Stylesheet failed: https://game.test/assets/main-abcd1234.css');
const missingBuild = new TypeError('Failed to fetch dynamically imported module: https://game.test/b/a3e7ef2-mw3ukc3m/pageEntry-1234abcd.js');
function fixture() {
  let taken = false;
  const version = vi.fn(() => Promise.resolve('new-build'));
  const prepare = vi.fn((_build: string) => Promise.resolve(true));
  const claim = vi.fn(() => { if (taken) return false; taken = true; return true; });
  const reload = vi.fn<() => void>();
  const ports = {allowed: () => true, base, runningBuild: 'old-build', version, prepare, claimed: () => taken, claim, reload};
  return {ports, version, prepare, claim, reload};
}
test('only same-origin deployment code and sheets classify as stale chunk failures', () => {
  for (const error of [missingJs, missingCss, missingBuild, new TypeError('Importing a module script failed.')]) expect(staleChunkFailure(error, base)).toBe(true);
  for (const error of [new Error('application invariant'), new TypeError('Failed to fetch'), new Error('Stylesheet failed: https://other.test/assets/main-abcd1234.css'),
    new Error('Stylesheet failed: https://game.test/unversioned.css')]) expect(staleChunkFailure(error, base)).toBe(false);
});
test.each([missingJs, missingCss, missingBuild])('a missing chunk prepares the actual new worker and reloads once (%s)', async failure => {
  const f = fixture(), recover = createChunkRecovery(f.ports);
  expect(await Promise.all([recover(failure), recover(failure)])).toEqual([true, true]);
  expect(f.version).toHaveBeenCalledOnce(); expect(f.prepare).toHaveBeenCalledExactlyOnceWith('new-build');
  expect(f.claim).toHaveBeenCalledOnce(); expect(f.reload).toHaveBeenCalledOnce();
  expect(await createChunkRecovery(f.ports)(failure)).toBe(false);
  expect(f.reload).toHaveBeenCalledOnce();
});
test('same-build, offline and failed adoption retain the original failure without a reload claim', async () => {
  const f = fixture(); f.version.mockResolvedValue('old-build');
  expect(await createChunkRecovery(f.ports)(missingJs)).toBe(false); expect(f.prepare).not.toHaveBeenCalled();
  const offline = createChunkRecovery({...f.ports, version: () => Promise.resolve(null)});
  expect(await offline(missingCss)).toBe(false);
  f.version.mockResolvedValue('new-build'); f.prepare.mockResolvedValue(false);
  expect(await createChunkRecovery(f.ports)(missingCss)).toBe(false);
  expect(f.claim).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
});
test('adoption must finish before the new document starts and unrelated errors never probe', async () => {
  const f = fixture(); let ready: ((result: boolean) => void) | undefined;
  f.prepare.mockImplementation(() => new Promise(resolve => {ready = resolve;}));
  const recover = createChunkRecovery(f.ports), pending = recover(missingJs);
  await Promise.resolve(); expect(f.reload).not.toHaveBeenCalled();
  if (ready === undefined) throw new Error('Adoption was not requested'); ready(true);
  expect(await pending).toBe(true);
  const ordinary = fixture(); expect(await createChunkRecovery(ordinary.ports)(new Error('real source refusal'))).toBe(false);
  expect(ordinary.version).not.toHaveBeenCalled();
});

test('a live world never probes or reloads and entering during discovery cancels adoption', async () => {
  const f = fixture(); let title = false;
  const ports = {...f.ports, allowed: () => title};
  expect(await createChunkRecovery(ports)(missingJs)).toBe(false);
  expect(f.version).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  title = true; f.version.mockImplementation(() => {title = false; return Promise.resolve('new-build');});
  expect(await createChunkRecovery(ports)(missingCss)).toBe(false);
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.claim).not.toHaveBeenCalled();
});
test('a world entered during worker preparation cannot spend the reload claim', async () => {
  const f = fixture(); let title = true;
  f.prepare.mockImplementation(() => {title = false; return Promise.resolve(true);});
  expect(await createChunkRecovery({...f.ports, allowed: () => title})(missingCss)).toBe(false);
  expect(f.claim).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
});
test('a refused build moves only to a newer one, once', async () => {
  const f = fixture();
  expect(await reloadIntoNewerBuild(f.ports)).toBe(true);
  expect(f.prepare).toHaveBeenCalledExactlyOnceWith('new-build'); expect(f.reload).toHaveBeenCalledOnce();
  expect(await reloadIntoNewerBuild(f.ports)).toBe(false);
  expect(f.reload).toHaveBeenCalledOnce();
  const same = fixture(); same.version.mockResolvedValue('old-build');
  expect(await reloadIntoNewerBuild(same.ports)).toBe(false);
  expect(same.claim).not.toHaveBeenCalled();
});
