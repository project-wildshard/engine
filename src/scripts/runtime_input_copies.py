"""Restore declared build copies from content-pinned installed package bytes."""
import hashlib
import json
from pathlib import PurePosixPath
import time


def restore_runtime_inputs(repo, tree, manifest, deadline):
    if manifest.get('version') != 1 or not isinstance(manifest.get('copies'), list):
        raise ValueError('Invalid copied runtime-input manifest')
    dependencies = json.loads((tree / 'package.json').read_text())
    dependencies = {**dependencies.get('devDependencies', {}), **dependencies.get('dependencies', {})}
    ready, targets = [], set()
    for row in manifest['copies']:
        if time.monotonic() >= deadline:
            raise TimeoutError('Copied runtime-input verification exceeded budget')
        source, target = row['source'], row['target']
        for name, prefix in [(source, 'node_modules/'), (target, 'public/')]:
            path = PurePosixPath(name)
            if not name.startswith(prefix) or path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe copied runtime input: ' + name)
        if target in targets:
            raise ValueError('Duplicate copied runtime input: ' + target)
        targets.add(target)
        package, version = row['package'], row['version']
        if dependencies.get(package) != version or not source.startswith('node_modules/' + package + '/'):
            raise ValueError('Copied runtime input differs from candidate dependency: ' + target)
        installed = json.loads((repo / 'node_modules' / package / 'package.json').read_text())
        if installed.get('name') != package or installed.get('version') != version:
            raise ValueError('Installed runtime-input package differs: ' + target)
        size = row['bytes']
        if not isinstance(size, int) or isinstance(size, bool) or not 0 <= size <= 64 * 1024 * 1024:
            raise ValueError('Invalid copied runtime-input size: ' + target)
        with (repo / source).open('rb') as handle:
            data = handle.read(size + 1)
        if len(data) != size or hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError('Copied runtime-input hash mismatch: ' + target)
        destination = tree / target
        if any(path.is_symlink() for path in [destination, *destination.parents] if path != tree.parent):
            raise ValueError('Copied runtime-input refuses symlink: ' + target)
        if destination.exists() and destination.read_bytes() != data:
            raise ValueError('Existing copied runtime input differs: ' + target)
        ready.append((destination, data))
    # Validate the complete set before writing any output. Shared public bytes
    # never enter this path; the payload is exactly the pinned package file.
    for destination, data in ready:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    return len(ready)
