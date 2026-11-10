// oxlint-disable-next-line import/no-nodejs-modules -- Name one exclusive, bounded request for this fixture's owned failed profile.
import {randomUUID} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Never follow request-directory or profile symlinks, and never dispose retained evidence.
import {openSync, closeSync, constants} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Python's standard openat interface pins each directory; Node has no openat API on Darwin.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The queue contract accepts only exact relative POSIX fixture paths.
import {relative, sep} from 'node:path';

// Isolated standard-library child; fd 3 is the already-open cwd. Every step
// uses dir_fd + O_NOFOLLOW, including exclusive leaf creation. No pathname
// checked by lstat is later followed for writing, even if ancestors move.
const writer = `import json, os, re, stat, sys
raw = sys.stdin.buffer.read(4097)
if len(raw) > 4096: raise ValueError('request exceeds 4096 bytes')
body = json.loads(raw)
if type(body) is not dict or set(body) != {'schema','kind','profile'} or body['schema'] != 'wildshard.native-retain/1': raise ValueError('bad request schema')
prefixes = {'native-escape':'tmp/escape-control-', 'native-writer-drain':'tmp/native-writer-drain-'}
prefix = prefixes.get(body['kind'])
if prefix is None or type(body['profile']) is not str or re.fullmatch(re.escape(prefix) + '[A-Za-z0-9]{6}', body['profile']) is None: raise ValueError('bad profile prefix')
leaf = sys.argv[1]
if re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.json', leaf) is None: raise ValueError('bad request UUID')
fds = []
def owned(fd, private=False):
    value = os.fstat(fd)
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != os.getuid() or (private and value.st_mode & 0o077): raise ValueError('unowned or nonprivate directory')
    return fd
def directory(parent, name, private=False):
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    fds.append(fd)
    return owned(fd, private)
try:
    root = owned(3)
    scratch = directory(root, 'tmp')
    directory(scratch, body['profile'][4:])
    try: os.mkdir('queue-retain-requests', 0o700, dir_fd=scratch)
    except FileExistsError: pass
    requests = directory(scratch, 'queue-retain-requests', True)
    fd = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=requests)
    with os.fdopen(fd, 'wb') as output: output.write(raw)
finally:
    for fd in reversed(fds): os.close(fd)
`;

/** Opt in to the queue's independently validated, capped failed-hook export.
 * This writes a request only; it never copies, deletes or grants a verdict.
 * @param {'native-writer-drain' | 'native-escape'} kind
 * @param {string} profile
 * @returns {string} The exclusive request's relative path.
 */
export function requestNativeRetention(kind, profile) {
  if (kind !== 'native-writer-drain' && kind !== 'native-escape') throw new Error('Unknown native retention kind');
  const path = relative(process.cwd(), profile).split(sep).join('/');
  const prefix = kind === 'native-escape' ? 'tmp/escape-control-' : 'tmp/native-writer-drain-';
  if (!new RegExp(`^${prefix}[A-Za-z0-9]{6}$`, 'u').test(path)) throw new Error('Native retention profile is outside its exact kind prefix');
  const body = JSON.stringify({schema: 'wildshard.native-retain/1', kind, profile: path});
  if (Buffer.byteLength(body) > 4096) throw new Error('Native retention request exceeds 4096 bytes');
  const leaf = `${randomUUID()}.json`, root = openSync('.', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    try {execFileSync('/usr/bin/python3', ['-I', '-B', '-c', writer, leaf], {input: body, encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe', root]});}
    catch (error) {
      const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).slice(-160) : String(error).slice(0, 160);
      throw new Error(`Native retention writer refused: ${detail}`);
    }
  } finally {closeSync(root);}
  return `tmp/queue-retain-requests/${leaf}`;
}
