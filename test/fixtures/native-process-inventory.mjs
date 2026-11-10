// oxlint-disable-next-line import/no-nodejs-modules -- Prepare a content-keyed native fixture executable before its cleanup clock.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Key the compiler output by its exact source, architecture and kernel ABI.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only the native fixture's generated scratch and atomic executable.
import {readFileSync, lstatSync, mkdirSync, mkdtempSync, linkSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Separate Darwin kernel ABI versions in the fixture cache.
import {release} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only this fixture's declared source and repository scratch.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Pass the actual filesystem source to the native compiler.
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('./native-process-inventory.c', import.meta.url));
const key = createHash('sha256').update(readFileSync(source)).update(process.arch).update(release()).digest('hex').slice(0, 20);
const binary = resolve(`tmp/native-process-inventory-${key}`);
const available = () => {
  try {
    const stat = lstatSync(binary);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) throw new Error('Native inventory cache is not a regular executable');
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
};

/** Compile and warm the Darwin tool in the existing resource-preparation phase,
 * before any browser startup or writer-drain deadline. Linux keeps its ps. */
export function warmNativeInventory() {
  if (process.platform !== 'darwin') return;
  if (!available()) {
    mkdirSync(resolve('tmp'), {recursive: true});
    const directory = mkdtempSync(resolve('tmp/native-inventory-build-'));
    try {
      const built = resolve(directory, 'inventory');
      execFileSync('/usr/bin/cc', ['-O2', '-Wall', '-Wextra', '-Werror', source, '-o', built], {timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe']});
      try {linkSync(built, binary);}
      catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST' && available())) throw error;}
    } finally {rmSync(directory, {recursive: true, force: true});}
  }
  // First execution includes native loader/code-signing preparation; this is
  // outside the unchanged 500 ms inventory and 5 s drain clocks.
  execFileSync(binary, [], {timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe']});
}

/** The real platform inventory; every returned row still meets the same guard.
 * @returns {{executable: string, args: string[]}} */
export function nativeInventoryCommand() {
  if (process.platform === 'darwin') {
    if (!available()) throw new Error('Native inventory resource was not prepared');
    return {executable: binary, args: []};
  }
  return {executable: 'ps', args: ['-axo', 'pid=,ppid=,pgid=,stat=']};
}
