#!/usr/bin/env python3
"""Ship the exact push build: source identity, full inventory and bounded extraction."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import tarfile
import time
import math


def digest(stream):
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(block)
    return value.hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return digest(stream)


def identity(sha, run):
    if not re.fullmatch('[0-9a-f]{40}', sha) or not re.fullmatch('[0-9]+', run):
        raise ValueError('Invalid prebuilt source identity')


def safe(name):
    path = PurePosixPath(name)
    if str(path) != name or path.is_absolute() or '\\' in name or any(p in ('', '.', '..') for p in path.parts):
        raise ValueError('Invalid prebuilt path')
    if not (name.startswith('.vercel/output/') or name.startswith('dist/')):
        raise ValueError('Unexpected prebuilt root')
    return path


def collect(directory):
    for path in sorted(directory.iterdir()):
        if path.is_symlink():
            yield path
        elif path.is_dir():
            yield from collect(path)
        elif path.is_file():
            yield path
        else:
            raise ValueError('Unsupported prebuilt entry')


def function_links(files):
    """Resolve the captured virtual tree, never the release runner's filesystem."""
    boundary = '.vercel/output/functions'
    names = {row['path'] for row in files}
    links = {row['path']: row['link'] for row in files if 'link' in row}
    directories = {str(parent) for name in names for parent in PurePosixPath(name).parents}
    for name in names:
        safe(name)
        if any(str(parent) in names for parent in PurePosixPath(name).parents):
            raise ValueError('Prebuilt member descends through a captured file or link')
    for name, target in links.items():
        if (not name.startswith(boundary + '/') or not isinstance(target, str) or not target
                or PurePosixPath(target).is_absolute() or '\\' in target
                or name.endswith('/.vc-config.json')):
            raise ValueError('Invalid prebuilt function link')

    def resolve_parts(current, parts, active):
        for part in parts:
            if current not in directories:
                raise ValueError('Prebuilt function link traverses a missing directory')
            if part in ('', '.'):
                continue
            if part == '..':
                current = str(PurePosixPath(current).parent)
                if current != boundary and not current.startswith(boundary + '/'):
                    raise ValueError('Prebuilt function dependency escapes functions root')
                continue
            candidate = current + '/' + part
            if candidate in links:
                if candidate in active:
                    raise ValueError('Cyclic prebuilt function link')
                current = resolve_parts(current, links[candidate].split('/'), active | {candidate})
            elif candidate in names or candidate in directories:
                current = candidate
            else:
                raise ValueError('Dangling prebuilt function link')
        return current

    def resolve(name):
        if name != boundary and not name.startswith(boundary + '/'):
            raise ValueError('Prebuilt function dependency escapes functions root')
        return resolve_parts(boundary, name[len(boundary):].split('/'), set())

    children = {}
    for name in names | directories:
        children.setdefault(str(PurePosixPath(name).parent), []).append(name)
    def walk(name, ancestors):
        target = resolve(name)
        if target not in directories:
            return
        if target in ancestors:
            raise ValueError('Cyclic prebuilt function directory')
        for child in children.get(target, []):
            walk(child, ancestors | {target})
    if boundary in directories:
        walk(boundary, set())
    for name in links:
        resolve(name)


def inventory(path, root):
    row = {'path': path.relative_to(root).as_posix(), 'mode': path.lstat().st_mode & 0o777}
    if path.is_symlink():
        row['link'] = os.readlink(path)
        content = row['link'].encode()
        row.update(bytes=len(content), hash=hashlib.sha256(content).hexdigest())
    else:
        row.update(bytes=path.stat().st_size, hash=file_hash(path))
    return row


def function_config(name, content, names):
    if not name.startswith('.vercel/output/functions/') or not name.endswith('/.vc-config.json'):
        return
    config = json.loads(content)
    if not isinstance(config, dict) or config.get('filePathMap') not in (None, {}):
        raise ValueError('Prebuilt function has external file references; build with --standalone: ' + name)
    handler = config.get('handler')
    if (not isinstance(handler, str) or not handler or str(PurePosixPath(handler)) != handler
            or PurePosixPath(handler).is_absolute() or '..' in PurePosixPath(handler).parts or '\\' in handler):
        raise ValueError('Invalid prebuilt function handler: ' + name)
    if str(PurePosixPath(name).parent / handler) not in names:
        raise ValueError('Missing prebuilt function handler: ' + name)


def required(files, sha, root):
    names = {row['path'] for row in files}
    for name in ('.vercel/output/config.json', '.vercel/output/static/index.html',
                 '.vercel/output/static/sw.js', '.vercel/output/static/version.json',
                 '.vercel/output/functions/api/inbox.func/.vc-config.json',
                 '.vercel/output/functions/api/errors.func/.vc-config.json',
                 '.vercel/output/functions/api/waitlist.func/.vc-config.json',
                 '.vercel/output/functions/api/telemetry.func/.vc-config.json',
                 'dist/version.json', 'dist/.vite/chunk-modules.json'):
        if name not in names:
            raise ValueError('Incomplete prebuilt output: ' + name)
    for name in names:
        if name.startswith('.vercel/output/functions/') and name.endswith('/.vc-config.json'):
            function_config(name, (root / name).read_bytes(), names)
    version = json.loads((root / '.vercel/output/static/version.json').read_text())
    # versionFiles.ts emits seven characters from VERCEL_GIT_COMMIT_SHA;
    # its git --short fallback uses the repository's configured abbreviation.
    # The authenticated producer and this proof still bind the full 40-char SHA.
    stamp = re.fullmatch(r'([0-9a-f]{7,40})-[0-9a-z]+', version.get('build', ''))
    if stamp is None or not sha.startswith(stamp[1]):
        raise ValueError('Prebuilt version differs from source: ' + str(version.get('build')))
    if (root / 'dist/version.json').read_bytes() != (root / '.vercel/output/static/version.json').read_bytes():
        raise ValueError('Diagnostic version differs from prebuilt version')


def pack(root, directory, sha, run):
    identity(sha, run)
    directory.mkdir(parents=True, exist_ok=True)
    paths = list(collect(root / '.vercel/output'))
    paths += [p for p in collect(root / 'dist') if p.relative_to(root / 'dist').as_posix() in
              ('version.json', '.vite/chunk-modules.json') or re.search(r'\.map(?:\.(?:gz|br))?$', p.name)]
    # Static output can link to dist; materialize only those aliases.
    expanded = []
    for path in paths:
        if path.is_symlink() and not path.relative_to(root).as_posix().startswith('.vercel/output/functions/'):
            if path.is_dir():
                expanded.extend(collect(path))
            else:
                expanded.append(path)
        else:
            expanded.append(path)
    paths = expanded
    files = [inventory(p, root) for p in paths]
    for path, row in zip(paths, files):
        if 'link' in row and not row['path'].startswith('.vercel/output/functions/'):
            row.pop('link')
            row.update(bytes=path.stat().st_size, hash=file_hash(path), mode=path.stat().st_mode & 0o777)
    function_links(files)
    required(files, sha, root)
    compressed = directory / 'prebuilt.tar.zst'
    value, size, complete = hashlib.sha256(), 0, False
    try:
        with compressed.open('wb') as destination:
            encoder = subprocess.Popen(['zstd', '-q', '-3', '-T2', '-c'],
                                       stdin=subprocess.PIPE, stdout=destination)

            class Sink:
                def write(self, block):
                    nonlocal size
                    written = encoder.stdin.write(block)
                    if written != len(block):
                        raise OSError('Incomplete prebuilt archive write')
                    value.update(block)
                    size += written
                    return written

            try:
                # Preserve the exact tar headers, member order, links and
                # padding while hashing those bytes on the way to zstd.
                with tarfile.open(fileobj=Sink(), mode='w|', dereference=False) as output:
                    for path, row in zip(paths, files):
                        safe(row['path'])
                        if 'link' in row:
                            output.add(path, arcname=row['path'], recursive=False)
                        else:
                            info = output.gettarinfo(str(path.resolve()), arcname=row['path'])
                            info.type, info.linkname, info.size = tarfile.REGTYPE, '', row['bytes']
                            with path.open('rb') as content:
                                output.addfile(info, content)
                encoder.stdin.close()
                if encoder.wait() != 0:
                    raise subprocess.CalledProcessError(encoder.returncode, encoder.args)
            finally:
                try:
                    if not encoder.stdin.closed:
                        encoder.stdin.close()
                except BrokenPipeError:
                    pass  # Preserve the originating encoder/write failure.
                finally:
                    if encoder.poll() is None:
                        encoder.kill()
                    encoder.wait()
        complete = True
    finally:
        if not complete:
            compressed.unlink(missing_ok=True)
    proof = {'version': 1, 'sha': sha, 'run': run, 'files': files,
             'archiveBytes': size, 'archiveHash': value.hexdigest()}
    proof['transport'] = {'bytes': compressed.stat().st_size, 'hash': file_hash(compressed)}
    (directory / 'proof.json').write_text(json.dumps(proof) + '\n')


class RestoreTimings:
    """Best-effort observation only; never a source verdict or an error owner."""
    def __init__(self, sha, run):
        self.sha, self.run = sha, run
        self.started = self.clock()
        self.points = {}
        self.proof = None
        self.complete = False

    @staticmethod
    def clock():
        try:
            return time.monotonic()
        except Exception:
            return None  # A diagnostic clock cannot change restoration.

    def mark(self, name):
        self.points[name] = self.clock()

    @staticmethod
    def elapsed(start, end):
        if start is None or end is None or not math.isfinite(end - start) or end < start:
            return None
        return end - start

    def report(self):
        try:
            end = self.clock()
            transport = self.points.get('transport')
            decoded = self.points.get('decoded')
            extracted = self.points.get('extracted')
            download_mode = os.environ.get('PREBUILT_DOWNLOAD_MODE', 'unknown')
            download = None
            if download_mode == 'gh-run-download':
                try:
                    seconds = int(os.environ.get('PREBUILT_DOWNLOAD_SECONDS', ''))
                    download = seconds if seconds >= 0 else None
                except ValueError:
                    pass
            proof = self.proof
            print(json.dumps({
                'report': 'ci2-prebuilt-restore', 'sha': self.sha, 'run': self.run,
                'complete': self.complete,
                'downloadMode': download_mode, 'downloadSeconds': download,
                'downloadResolutionSeconds': 1,
                'downloadScope': 'gh run download including GitHub ZIP materialization; not pure network',
                'transportCheckSeconds': self.elapsed(self.started, transport),
                'decodeSeconds': self.elapsed(transport, decoded),
                'decodeScope': 'zstd, bounded temporary tar writes and archive checksum',
                'extractSeconds': self.elapsed(decoded, extracted),
                'extractScope': 'full member validation, file/link writes and required-output checks',
                'restoreSeconds': self.elapsed(self.started, end),
                'compressedBytes': None if proof is None else proof['transport']['bytes'],
                'archiveBytes': None if proof is None else proof['archiveBytes'],
                'memberBytes': None if proof is None else sum(row['bytes'] for row in proof['files']),
                'files': None if proof is None else len(proof['files']),
            }))
        except Exception:
            pass  # Clock, metadata and diagnostic I/O never replace the native outcome.


def restore(root, directory, sha, run, *, timings=False):
    observation = RestoreTimings(sha, run) if timings else None
    try:
        _restore(root, directory, sha, run, observation)
        if observation is not None:
            observation.complete = True
    finally:
        if observation is not None:
            observation.report()


def _restore(root, directory, sha, run, observation):
    identity(sha, run)
    proof = json.loads((directory / 'proof.json').read_text())
    if proof['version'] != 1 or proof['sha'] != sha or proof['run'] != run:
        raise ValueError('Prebuilt source SHA/run differs')
    compressed = directory / 'prebuilt.tar.zst'
    if compressed.stat().st_size != proof['transport']['bytes'] or file_hash(compressed) != proof['transport']['hash']:
        raise ValueError('Prebuilt transport checksum differs')
    limit = proof['archiveBytes']
    if type(limit) is not int or limit <= 0:
        raise ValueError('Invalid prebuilt archive extent')
    if observation is not None:
        observation.proof = proof
        observation.mark('transport')
    with tempfile.TemporaryFile(dir=directory) as archive:
        decoder = subprocess.Popen(['zstd', '-q', '-dc', str(compressed)], stdout=subprocess.PIPE)
        size, value = 0, hashlib.sha256()
        try:
            for block in iter(lambda: decoder.stdout.read(min(1024 * 1024, limit - size + 1)), b''):
                size += len(block)
                if size > limit:
                    raise ValueError('Prebuilt archive exceeds proof')
                archive.write(block)
                value.update(block)
            if decoder.wait() != 0 or size != limit or value.hexdigest() != proof['archiveHash']:
                raise ValueError('Prebuilt archive checksum differs')
        finally:
            decoder.stdout.close()
            if decoder.poll() is None:
                decoder.kill()
            decoder.wait()
        if observation is not None:
            observation.mark('decoded')
        archive.seek(0)
        extract(root, archive, proof, sha)
        if observation is not None:
            observation.mark('extracted')


def extract(root, archive, proof, sha):
    rows = proof['files']
    names = [row['path'] for row in rows]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate prebuilt inventory')
    function_links(rows)
    # Validate every byte and bounded function link before writing anything.
    # Devices, extra/missing members and existing destination links refuse.
    with tarfile.open(fileobj=archive, mode='r:') as source:
        members = source.getmembers()
        if [member.name for member in members] != names:
            raise ValueError('Prebuilt inventory differs')
        for member, row in zip(members, rows):
            path = root / safe(member.name)
            if 'link' in row:
                content = row['link'].encode()
                valid = (member.issym() and member.linkname == row['link'] and member.size == 0
                         and len(content) == row['bytes'] and hashlib.sha256(content).hexdigest() == row['hash'])
            else:
                valid = member.isfile() and member.size == row['bytes']
            if (not valid or member.mode != row['mode']
                    or type(row['bytes']) is not int or row['bytes'] < 0):
                raise ValueError('Invalid prebuilt member')
            if path.exists() or path.is_symlink() or any(p.is_symlink() for p in path.parents):
                raise ValueError('Prebuilt destination already exists or links outside root')
            if 'link' not in row:
                with source.extractfile(member) as stream:
                    if digest(stream) != row['hash']:
                        raise ValueError('Prebuilt member hash differs')
            if member.name.startswith('.vercel/output/functions/') and member.name.endswith('/.vc-config.json'):
                with source.extractfile(member) as stream:
                    function_config(member.name, stream.read(), names)
        for member, row in zip(members, rows):
            path = root / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            if 'link' in row:
                continue
            with source.extractfile(member) as stream, path.open('xb') as target:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    target.write(block)
            path.chmod(row['mode'])
        for row in rows:
            if 'link' in row:
                path = root / row['path']
                path.parent.mkdir(parents=True, exist_ok=True)
                path.symlink_to(row['link'])
    required(rows, sha, root)
    print(json.dumps({'sha': sha, 'run': proof['run'], 'files': len(rows), 'archiveHash': proof['archiveHash']}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('pack', 'restore'))
    parser.add_argument('--sha', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--directory', type=Path, default=Path('prebuilt-output'))
    parser.add_argument('--timings', action='store_true', help='Report-only restore phase clocks and extents')
    args = parser.parse_args()
    if args.command == 'restore':
        restore(args.root, args.directory, args.sha, args.run, timings=args.timings)
    else:
        pack(args.root, args.directory, args.sha, args.run)


if __name__ == '__main__':
    main()
