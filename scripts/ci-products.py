#!/usr/bin/env python3
"""Transfer one CI run's generated inputs and products to its behaviour jobs."""
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile

ARCHIVE = 'test-products.tar'
PROOF = 'test-products-proof.json'
PHASE = '.cache/generation-phase.json'
DERIVED_BUDGET = 'budgets/ceiling-sources.json'
GENERATED_ROOTS = ['src', 'public', 'out', 'docs/api', 'lint']
# Explicitly catalogued discovery modules share generation proof. No product or arbitrary out file does.
APP_INPUTS = frozenset()
EXCLUDED = {'.git', 'node_modules', '.cache', '__pycache__'}


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def identity(root):
    sha, run = os.environ['GITHUB_SHA'], os.environ['GITHUB_RUN_ID']
    if git(root, 'rev-parse', 'HEAD').decode().strip() != sha:
        raise ValueError('Checkout does not match the CI SHA')
    return sha, run


def admitted_path(name):
    path = PurePosixPath(name)
    # gen refreshes only this budget file's derived rows; carry its exact bytes
    # under the existing SHA/run/checksum proof, never the whole policy folder.
    if name in {PHASE, DERIVED_BUDGET}:
        return path
    if (not name or path.is_absolute() or '..' in path.parts
            or any(part in EXCLUDED or part.startswith('.env') for part in path.parts)
            or path.parts[0] not in {'src', 'public', 'out', 'docs', 'lint', 'scripts', 'test', 'api', 'admin', 'drafts'}):
        raise ValueError('Unexpected prepared output path: ' + name)
    return path


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


class ArchiveWriter:
    """Hash every tar byte as it is written, including headers and padding."""

    def __init__(self, stream):
        self.stream = stream
        self.checksum = hashlib.sha256()

    def tell(self):
        return self.stream.tell()

    def write(self, block):
        written = self.stream.write(block)
        if written != len(block):
            raise OSError('Incomplete prepared archive write')
        self.checksum.update(block)
        return written


def target(root, name):
    path = root / admitted_path(name)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != root):
        raise ValueError('Unsafe prepared output: ' + name)
    if root.resolve() not in path.resolve().parents:
        raise ValueError('Unsafe prepared output: ' + name)
    return path


def tracked_files(root):
    # Use the exact committed tree, never the shared index or working diff.
    rows = {}
    for record in git(root, 'ls-tree', '-rz', 'HEAD').split(b'\0'):
        if not record:
            continue
        metadata, name = record.split(b'\t', 1)
        mode, kind, oid = metadata.split()
        if kind == b'blob' and mode in {b'100644', b'100755'}:
            rows[os.fsdecode(name)] = (int(mode, 8) & 0o777, oid.decode())
    return rows


def file_identity(path, object_format):
    size = path.stat().st_size
    blob = hashlib.new(object_format)
    blob.update(f'blob {size}\0'.encode())
    sha256 = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            blob.update(chunk)
            sha256.update(chunk)
    return size, sha256.hexdigest(), blob.hexdigest()


def source_outputs(root):
    registry = json.loads((root / 'scripts/source-generation-outputs.json').read_text())['producers']
    declared = {path for outputs in registry.values() for path in outputs}
    return declared, declared


def app_inputs(root):
    registry = json.loads((root / 'scripts/source-generation-outputs.json').read_text())['producers']
    discovery = {name for name in registry.get('scripts/gen-shards.mjs', [])
                 if PurePosixPath(name).parts[:2] == ('out', '.app')
                 and len(PurePosixPath(name).parts) == 3
                 and re.fullmatch(r'discovery\.[a-z0-9_.-]+\.generated\.ts', PurePosixPath(name).name)}
    return APP_INPUTS | discovery


def archive_names(generated):
    return ('generated-inputs.tar', 'generated-inputs-proof.json') if generated else (ARCHIVE, PROOF)


def pack(root, generated=False):
    archive_name, proof_name = archive_names(generated)
    sha, run = identity(root)
    declared, required = source_outputs(root)
    missing = sorted(name for name in required if not (root / admitted_path(name)).is_file())
    if missing:
        raise ValueError('Missing prepared source outputs: ' + ', '.join(missing))
    ignored = git(root, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', *GENERATED_ROOTS)
    untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', *GENERATED_ROOTS)
    modified = git(root, 'diff', '--name-only', '-z', '--diff-filter=AM')
    # Catalogue rows include retained and freshly emitted hashes regardless of
    # their gitignore status. The Git walk adds gen's tables, product outputs,
    # and build policy (.wildshard/build-policy.json) outside that catalogue.
    files = sorted({name for name in declared if (root / admitted_path(name)).is_file()}
                   | {os.fsdecode(name) for name in (ignored + untracked + modified).split(b'\0') if name})
    files = [name for name in files if not any(part in EXCLUDED for part in PurePosixPath(name).parts)]
    if generated:
        admitted_app = app_inputs(root)
        files = [name for name in files if not name.startswith('out/') or name in admitted_app]
    if (root / PHASE).is_file():
        files.append(PHASE)
    if generated and PHASE not in files:
        raise ValueError('Generated preparation is missing its verified phase receipt')
    if not generated and not any(name.startswith('out/') and name.endswith('/shard.json') for name in files):
        raise ValueError('No prepared products to publish')
    tracked = tracked_files(root)
    object_format = git(root, 'rev-parse', '--show-object-format').decode().strip()
    retained = {}
    duplicates, content = {}, {}
    archived = 0
    with (root / archive_name).open('wb') as output:
        writer = ArchiveWriter(output)
        with tarfile.open(fileobj=writer, mode='w') as archive:
            for name in files:
                path = target(root, name)
                if not path.is_file() or path.is_symlink():
                    raise ValueError('Prepared output is not a regular file: ' + name)
                source = tracked.get(name)
                if source is not None and not name.startswith('out/'):
                    size, sha256, blob = file_identity(path, object_format)
                    mode = path.stat().st_mode & 0o777
                    if source == (mode, blob):
                        retained[name] = {'size': size, 'sha256': sha256, 'blob': blob, 'mode': mode}
                        continue
                # Reconstruct repeated large payloads as regular files. Artifact
                # compression has a bounded window; distant copies of identical
                # assets otherwise cross the network once for every product.
                size = path.stat().st_size
                if size >= 65536:
                    sha256 = digest(path)
                    key = (size, sha256)
                    previous = content.get(key)
                    if previous is not None:
                        duplicates[name] = {'source': previous, 'size': size,
                                            'sha256': sha256, 'mode': path.stat().st_mode & 0o777}
                        continue
                    content[key] = name
                archive.add(path, arcname=name, recursive=False)
                archived += 1
    proof = {'sha': sha, 'run': run, 'sha256': writer.checksum.hexdigest(),
             'files': archived, 'retained': retained, 'duplicates': duplicates}
    (root / proof_name).write_text(json.dumps(proof) + '\n')
    print(f'Published {archived} prepared files, {len(duplicates)} duplicate paths and verified {len(retained)} checkout files for {sha} in run {run}')


def unpack(root, generated=False):
    archive_name, proof_name = archive_names(generated)
    sha, run = identity(root)
    proof = json.loads((root / proof_name).read_text())
    if proof['sha'] != sha or proof['run'] != run:
        raise ValueError('Prepared products belong to a different SHA or CI run')
    if proof['sha256'] != digest(root / archive_name):
        raise ValueError('Prepared products checksum mismatch')
    with tarfile.open(root / archive_name, 'r') as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != proof['files'] or len(set(names)) != len(names):
            raise ValueError('Prepared output inventory mismatch')
        retained = proof.get('retained', {})
        if not isinstance(retained, dict) or set(retained).intersection(names):
            raise ValueError('Prepared retained inventory overlaps the archive')
        duplicates = proof.get('duplicates', {})
        if (not isinstance(duplicates, dict)
                or set(duplicates).intersection(names + list(retained))):
            raise ValueError('Prepared duplicate inventory overlaps other outputs')
        inventory = names + list(retained) + list(duplicates)
        paths = set(inventory)
        if any(str(parent) in paths for name in inventory
               for parent in PurePosixPath(name).parents):
            raise ValueError('Unsafe prepared output hierarchy')
        _, required = source_outputs(root)
        if not required.issubset(inventory):
            raise ValueError('Prepared catalogue outputs are missing from the archive')
        if generated and PHASE not in names:
            raise ValueError('Generated preparation is missing its verified phase receipt')
        if generated and any(name.startswith('out/') and name not in app_inputs(root) for name in inventory):
            raise ValueError('Generated-only preparation cannot contain products')
        if not generated and not any(name.startswith('out/') and name.endswith('/shard.json') for name in names):
            raise ValueError('Prepared products are missing')
        tracked = tracked_files(root)
        object_format = git(root, 'rev-parse', '--show-object-format').decode().strip()
        for name, row in retained.items():
            path = target(root, name)
            if not path.is_file() or tracked.get(name) != (row['mode'], row['blob']):
                raise ValueError('Missing or untracked retained output: ' + name)
            size, sha256, blob = file_identity(path, object_format)
            if (size, sha256, blob, path.stat().st_mode & 0o777) != (row['size'], row['sha256'], row['blob'], row['mode']):
                raise ValueError('Retained output differs from exact checkout: ' + name)
        # Validate the entire inventory before writing any file. Never follow a
        # workspace symlink, even when the archive itself has no link members.
        for member in members:
            path = target(root, member.name)
            if not member.isfile() or path.exists() and not path.is_file():
                raise ValueError('Unsafe prepared output: ' + member.name)
        # Validate every reconstruction target and source before writing any
        # output. Sources must be real archived members, never links or chains.
        by_name = {member.name: member for member in members}
        verified = set()
        for name, row in duplicates.items():
            path = target(root, name)
            if path.exists() and not path.is_file():
                raise ValueError('Unsafe prepared output: ' + name)
            if (not isinstance(row, dict) or set(row) != {'source', 'size', 'sha256', 'mode'}
                    or not isinstance(row['source'], str) or row['source'] not in by_name
                    or type(row['size']) is not int or row['size'] < 65536
                    or type(row['mode']) is not int or not 0 <= row['mode'] <= 0o777
                    or not isinstance(row['sha256'], str)):
                raise ValueError('Invalid prepared duplicate: ' + name)
            member = by_name[row['source']]
            key = (row['source'], row['size'], row['sha256'])
            if key not in verified:
                result = hashlib.sha256()
                with archive.extractfile(member) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        result.update(chunk)
                if member.size != row['size'] or result.hexdigest() != row['sha256']:
                    raise ValueError('Prepared duplicate checksum mismatch: ' + name)
                verified.add(key)
        for member in members:
            path = root / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError('Missing prepared file: ' + member.name)
            with stream, path.open('wb') as destination:
                shutil.copyfileobj(stream, destination)
            path.chmod(member.mode & 0o777)
        for name, row in duplicates.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / row['source'], path)
            path.chmod(row['mode'])
    print(f'Restored {len(members)} prepared files, {len(duplicates)} duplicate paths and verified {len(retained)} checkout files for {sha} in run {run}')


if __name__ == '__main__':
    command = sys.argv[1]
    {'pack': pack, 'unpack': unpack,
     'pack-generated': lambda root: pack(root, generated=True),
     'unpack-generated': lambda root: unpack(root, generated=True)}[command](Path.cwd())
