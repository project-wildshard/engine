"""Source type tables from a completed generation phase, never from loose WIP."""
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import time


def source_key(records, roots):
    exact, prefixes = set(roots), tuple(root + '/' for root in roots)
    selected = [row for row in records if ('.' in exact and b'/' not in row.split(b'\t', 1)[1]) or row.split(b'\t', 1)[1].decode() in exact or
                row.split(b'\t', 1)[1].decode().startswith(prefixes)]
    return hashlib.sha256(b'\0'.join(selected)).hexdigest()


def phase_outputs(repo, revision, generated, records, deadline=None):
    """Read a completed generation phase only when its inputs match Git blobs."""
    phase = generated / '.cache/generation-phase.json'
    saved = json.loads(phase.read_text())
    seal = saved.pop('seal')
    text = json.dumps(saved, ensure_ascii=False, separators=(',', ':'))
    if hashlib.sha256(text.encode()).hexdigest() != seal or saved['root'] != str(generated):
        raise ValueError('Invalid generation phase cache')
    tracked = {row.split(b'\t', 1)[1].decode(): row.split(b'\t', 1)[0].split()[2] for row in records}
    declared = set()
    if 'scripts/source-generation-outputs.json' in tracked:
        source = json.loads(subprocess.check_output(['git', 'show', revision + ':scripts/source-generation-outputs.json'], cwd=repo))
        declared.update(name for rows in source['producers'].values() for name in rows)
    pre_tables = {'src/shared/game/bag/starter.generated.ts', 'src/client/game/systems/effects/starter.generated.ts',
                  'src/client/game/systems/viewmodel/clips.generated.ts', 'src/shared/game/weapons/starter.generated.ts'}
    for folder, inventory in saved['trees'].items():
        actual = {name for name in tracked if name.startswith(folder + '/')}
        omitted = actual - set(inventory)
        if any(not (name.startswith('src/') and '.generated.' in name and name not in declared and
                    not name.endswith('/ktx2.generated.ts') and name not in pre_tables) for name in omitted):
            raise ValueError('Generation phase source inventory differs: ' + folder)
    files = [name for name in saved['inputs'] if name in tracked and name not in saved['outputs']]
    raw = subprocess.check_output(['git', 'cat-file', '--batch'], cwd=repo,
                                  input=b''.join(tracked[name] + b'\n' for name in files),
                                  timeout=None if deadline is None else max(.01, deadline - time.monotonic()))
    at = 0
    for name in files:
        end = raw.index(b'\n', at)
        size = int(raw[at:end].split()[2])
        data = raw[end + 1:end + 1 + size]
        at = end + size + 2
        if hashlib.sha256(data).hexdigest() != saved['inputs'][name]:
            raise ValueError('Generation phase source differs from commit: ' + name)
    tables = {}
    for name, digest in saved['inputs'].items():
        if name in tracked and name not in saved['outputs']:
            continue
        post_table = name in {'src/shared/game/bag/starter.generated.ts', 'src/client/game/systems/effects/starter.generated.ts',
                              'src/client/game/systems/viewmodel/clips.generated.ts', 'src/shared/game/weapons/starter.generated.ts'} or (
            name.startswith('src/shards/') and (name.endswith('/.wildshard/build-policy.json') or name.endswith('/discovery.generated.ts')))
        # Intrinsic producer assets are named by their complete content hash,
        # rather than a fixed catalogue path. Admit only that exact address;
        # ordinary untracked source/data inputs remain forbidden.
        address = re.fullmatch(r'(?:[\w.-]+-)?([0-9a-f]{64})(?:\.(?:bin|glb|ktx2|png|webp|jpg))?', Path(name).name)
        intrinsic = '..' not in Path(name).parts and (
            re.match(r'^src/shards/[a-z0-9_-]+/assets/', name) is not None or name.startswith('public/assets/')) and (
                address is not None and address.group(1) == digest)
        if name not in saved['outputs'] and not post_table and not intrinsic:
            raise ValueError('Undeclared generation phase input: ' + name)
        if hashlib.sha256((generated / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Generation phase input changed: ' + name)
        if post_table:
            tables[name] = digest
    if (generated.parent / 'HEAD').read_text().split()[0] != revision:
        raise ValueError('Generation phase moved while reading')
    post_file = generated / '.cache/push-post-inputs.json'
    if post_file.exists():
        post = json.loads(post_file.read_text())
        post_seal = post.pop('seal')
        if hashlib.sha256(json.dumps(post, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest() != post_seal or (
                post['schema'] != 'push-post-inputs/1' or post['root'] != str(generated) or
                post['revision'] != revision or post['phase'] != seal):
            raise ValueError('Invalid post-generation proof')
        def source(name):
            return (name.startswith(('src/', 'scripts/', 'lint/', 'vite/', 'budgets/')) or '/' not in name) and (
                re.search(r'\.(?:[cm]?[jt]sx?|jsonc?|yaml|yml|as|py|sh|html|css|wgsl|glsl)$', name) is not None) and '.generated.' not in name
        expected = {name for name in tracked if source(name)}
        if not expected.issubset(post['inputs']) or not set(post['inputs']).issubset(tracked):
            raise ValueError('Post-generation input inventory differs')
        raw = subprocess.check_output(['git', 'cat-file', '--batch'], cwd=repo,
                                      input=b''.join(tracked[name] + b'\n' for name in post['inputs']),
                                      timeout=None if deadline is None else max(.01, deadline - time.monotonic()))
        at = 0
        for name, digest in post['inputs'].items():
            end = raw.index(b'\n', at)
            size = int(raw[at:end].split()[2])
            data = raw[end + 1:end + 1 + size]
            at = end + size + 2
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Post-generation source differs from commit: ' + name)
        for name, digest in post['outputs'].items():
            if not name.startswith(('src/', 'lint/')) or '..' in Path(name).parts or '.generated.' not in name:
                raise ValueError('Invalid post-generation output path')
            blob = generated / '.cache/push-post-blobs' / digest
            data = blob.read_bytes() if blob.exists() else (generated / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Post-generation output changed: ' + name)
        tables.update(post['outputs'])
    return {**saved['outputs'], **tables}


def phase_roots(generated):
    saved = json.loads((generated / '.cache/generation-phase.json').read_text())
    folders = set(saved['trees'])
    files = {name for name in saved['inputs'] if not name.startswith(tuple(folder + '/' for folder in folders))}
    post_file = generated / '.cache/push-post-inputs.json'
    if post_file.exists():
        post = json.loads(post_file.read_text())
        files.update(name for name in post['inputs'] if '/' not in name)
        folders.update({'.', 'src', 'scripts', 'lint', 'vite', 'budgets'})
    return sorted(files | folders | {'scripts/source-generation-outputs.json'})


def publish(repo, revision, generated, deadline=None):
    """Only an immutable phase with committed inputs can seed the type cache."""
    records = [row for row in subprocess.check_output(['git', 'ls-tree', '-rz', revision], cwd=repo).split(b'\0') if row]
    phase = generated / '.cache/generation-phase.json'
    phase_bytes = phase.read_bytes()
    post_file = generated / '.cache/push-post-inputs.json'
    post_bytes = post_file.read_bytes() if post_file.exists() else None
    verified = phase_outputs(repo, revision, generated, records, deadline)
    roots = phase_roots(generated)
    tracked = {row.split(b'\t', 1)[1].decode() for row in records}
    cache = repo / 'tmp/push-input-cache'
    blobs = cache / 'blobs'
    blobs.mkdir(parents=True, exist_ok=True)
    files, test_files = {}, {}
    # Original species fixtures construct their packed bank from this declared
    # raw source. Publish it only through the same verified phase-output path.
    bootstrap = {'public/assets/nalati/baked/bodies.bin'}
    for name, expected in verified.items():
        if deadline is not None and time.monotonic() >= deadline:
            raise TimeoutError('Type-input cache publication exceeded budget')
        path = generated / name
        source = name not in tracked and name.startswith(('src/', 'lint/')) and path.suffix in ('.ts', '.mts', '.json')
        if not source and name not in bootstrap:
            continue
        post_blob = generated / '.cache/push-post-blobs' / expected
        data = post_blob.read_bytes() if post_blob.exists() else path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Generation phase output changed: ' + name)
        target = blobs / expected
        if not target.exists():
            target.write_bytes(data)
        if source:
            files[name] = expected
        else:
            test_files[name] = expected
    # Re-read the marker after all input/output reads; a moving phase refuses.
    if (generated.parent / 'HEAD').read_text().split()[0] != revision or phase.read_bytes() != phase_bytes or (
            (post_file.read_bytes() if post_file.exists() else None) != post_bytes):
        raise ValueError('Generation phase moved while publishing')
    saved = {'schema': 'push-type-inputs/3', 'revision': revision, 'roots': roots,
             'key': source_key(records, roots), 'files': files, 'testFiles': test_files, 'post': post_bytes is not None}
    temporary = cache / ('entries.' + str(os.getpid()) + '.tmp')
    temporary.write_text(json.dumps(saved))
    temporary.replace(cache / 'entries.json')
    history = cache / 'sets'
    history.mkdir(exist_ok=True)
    path = history / (revision + '-' + saved['key'] + '.json')
    temporary = path.with_suffix('.' + str(os.getpid()) + '.tmp')
    temporary.write_text(json.dumps(saved))
    temporary.replace(path)
    for stale in sorted(history.glob('*.json'), key=lambda item: item.stat().st_mtime, reverse=True)[20:]:
        stale.unlink(missing_ok=True)
    return len(files)


def restore(repo, tree, records, deadline):
    """A miss never supplies old declarations or runs a producer."""
    file = repo / 'tmp/push-input-cache/entries.json'
    deadline = min(deadline, time.monotonic() + 8)
    def matches(saved):
        try:
            return isinstance(saved, dict) and saved.get('schema') == 'push-type-inputs/3' and source_key(records, saved['roots']) == saved['key']
        except (KeyError, TypeError):
            return False
    try:
        saved = json.loads(file.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        saved = None
    if not matches(saved):
        for entry in sorted((file.parent / 'sets').glob('*.json'), key=lambda path: path.stat().st_mtime, reverse=True):
            try:
                candidate = json.loads(entry.read_text())
                if matches(candidate):
                    saved = candidate
                    break
            except (OSError, ValueError):
                continue
    if not matches(saved):
        # Read completed cache metadata only. No mirror process, generation,
        # build, producer or mutable working-tree output is run or copied.
        phases = list((repo / 'tmp/build-mirror').glob('*/tree/.cache/generation-phase.json'))
        phases.sort(key=lambda path: path.stat().st_mtime, reverse=True)
        for phase in phases:
            if time.monotonic() >= deadline:
                return False
            generated = phase.parent.parent
            try:
                revision = (generated.parent / 'HEAD').read_text().split()[0]
                baseline = [row for row in subprocess.check_output(['git', 'ls-tree', '-rz', revision], cwd=repo, timeout=max(.01, deadline - time.monotonic())).split(b'\0') if row]
                roots = phase_roots(generated)
                if source_key(records, roots) != source_key(baseline, roots):
                    continue
                publish(repo, revision, generated, deadline)
                saved = json.loads(file.read_text())
                break
            except (ValueError, OSError, KeyError, TypeError):
                continue
            except (TimeoutError, subprocess.TimeoutExpired):
                return False
    if not matches(saved):
        return False
    try:
        verified = []
        for name, digest in saved['files'].items():
            if time.monotonic() >= deadline:
                raise TimeoutError('Type-input cache verification exceeded budget')
            if not name.startswith(('src/', 'lint/')) or '..' in Path(name).parts or re.fullmatch(r'[0-9a-f]{64}', digest) is None:
                raise ValueError('Invalid type-input cache path')
            path = tree / name
            if any(parent.is_symlink() for parent in [path, *path.parents] if parent != tree.parent):
                raise ValueError('Symlink parent in type-input cache path')
            data = (file.parent / 'blobs' / digest).read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Corrupt type-input cache blob')
            if path.exists():
                if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise ValueError('Existing generated output differs from verified type inputs')
                continue
            verified.append((path, data))
        for path, data in verified:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return True
    except (OSError, KeyError, ValueError, TypeError, TimeoutError):
        return False


def restore_tests(repo, tree, records, deadline, include=None):
    """An older verified generation is useful for tests, never current types.

    Its source key must still describe its original Git revision and every
    blob is checked before any writes, including blobs omitted by include.
    The optional predicate limits materialization, never verification.
    No loose generated output is trusted.
    """
    cache = repo / 'tmp/push-input-cache'
    entry = cache / 'entries.json'
    deadline = min(deadline, time.monotonic() + 8)
    candidates = [entry, *sorted((cache / 'sets').glob('*.json'), key=lambda path: path.stat().st_mtime, reverse=True)]
    phases = sorted((repo / 'tmp/build-mirror').glob('*/tree/.cache/generation-phase.json'),
                    key=lambda path: path.stat().st_mtime, reverse=True)
    candidates.extend(phases)
    tracked = {row.split(b'\t', 1)[1].decode() for row in records}
    for candidate in candidates:
        if time.monotonic() >= deadline:
            break
        try:
            if candidate.name == 'generation-phase.json':
                generated = candidate.parent.parent
                revision = (generated.parent / 'HEAD').read_text().split()[0]
                publish(repo, revision, generated, deadline)
                saved = json.loads(entry.read_text())
            else:
                saved = json.loads(candidate.read_text())
            if saved.get('schema') != 'push-type-inputs/3' or 'testFiles' not in saved:
                continue
            if not saved.get('post') and any(name.endswith('/manifest.json') for name in tracked):
                continue
            revision = saved['revision']
            if re.fullmatch(r'[0-9a-f]{40}', revision) is None:
                continue
            baseline = [row for row in subprocess.check_output(
                ['git', 'ls-tree', '-rz', revision], cwd=repo,
                timeout=max(.01, deadline - time.monotonic())).split(b'\0') if row]
            if source_key(baseline, saved['roots']) != saved['key']:
                continue
            verified = []
            for name, digest in {**saved['files'], **saved.get('testFiles', {})}.items():
                if time.monotonic() >= deadline:
                    raise TimeoutError('Test-input verification exceeded budget')
                path = tree / name
                if not name.startswith(('src/', 'lint/', 'public/')) or '..' in Path(name).parts or re.fullmatch(r'[0-9a-f]{64}', digest) is None or any(
                        parent.is_symlink() for parent in [path, *path.parents] if parent != tree.parent):
                    raise ValueError('Invalid test-input path')
                data = (cache / 'blobs' / digest).read_bytes()
                if hashlib.sha256(data).hexdigest() != digest:
                    raise ValueError('Corrupt test-input blob')
                if (name not in tracked or name.startswith('public/')) and (include is None or include(name)):
                    verified.append((path, data))
            for path, data in verified:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            return revision
        except (OSError, KeyError, TypeError, ValueError, TimeoutError, subprocess.TimeoutExpired):
            continue
    return None
