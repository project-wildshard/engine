/** SHARD-COMPAT SP1b5a: the record job's `prepare` port on a host. It runs the author's own recorder, `wildshard prepare
 * <folder>`, against this engine's preparation client (`WILDSHARD_PREPARATION_CLIENT`, built from the same checkout as the
 * cook, so the recording names the cook's renderer), under the host's wrap (on the box: its own user, no network but the
 * local page), with a deadline. The child gets no credentials: only PATH, a scratch HOME, the client and the host's named
 * extras. */
// oxlint-disable-next-line import/no-nodejs-modules -- The record job starts the recorder (J28).
import {spawn} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The recorder's scratch home.
import {mkdirSync, rmSync} from 'node:fs';
import {Scope} from '@wildshard/engine/app/scope';

export interface RecorderLauncher {
  /** The `wildshard` command, such as an installed `@wildshard/dev`'s bin. */
  readonly command: readonly string[];
  /** This engine's preparation client folder (`devserver-client.mjs --kind preparation --keep <folder>`). */
  readonly client: string;
  /** The host's prefix, such as the box's sandbox; empty locally. */
  readonly wrap: readonly string[];
  readonly seconds: number;
  /** What else the host's recorder needs, such as `PLAYWRIGHT_BROWSERS_PATH` for its WebKit; never a credential. */
  readonly env?: Readonly<Record<string, string>>;
}

const TAIL_BYTES = 4000;

/** The `prepare` port for `recordSidecars`: resolves when the recorder wrote the folder's preparation, rejects with the
 *  last line of its output otherwise. Its scratch home sits beside the folder and goes with it. */
export function wildshardPrepare(launcher: RecorderLauncher): (folder: string) => Promise<void> {
  return folder => new Promise((resolve, reject) => {
    const home = `${folder}-home`;
    mkdirSync(home, {recursive: true});
    const [command, ...args] = [...launcher.wrap, ...launcher.command, 'prepare', folder];
    const child = spawn(command, args, {env: {...launcher.env, PATH: process.env['PATH'] ?? '', HOME: home, WILDSHARD_PREPARATION_CLIENT: launcher.client}, stdio: ['ignore', 'pipe', 'pipe']});
    let tail = '';
    const keep = (text: string): void => { tail = (tail + text).slice(-TAIL_BYTES); };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    const scope = new Scope('wildshard prepare');
    scope.timeout(launcher.seconds * 1000, () => { child.kill('SIGKILL'); });
    const done = (): void => { scope.dispose(); rmSync(home, {recursive: true, force: true}); };
    child.on('error', error => { done(); reject(error); });
    child.on('close', (code, signal) => {
      done();
      if (code === 0) { resolve(); return; }
      const why = signal === null ? `exit ${String(code)}` : `past ${launcher.seconds} s (${signal})`;
      reject(new Error(`wildshard prepare ${why}: ${tail.trim().split('\n').at(-1) ?? ''}`));
    });
  });
}
