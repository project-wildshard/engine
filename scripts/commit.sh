#!/usr/bin/env bash
# Commit only named paths in the real main checkout. Git runs the installed hooks.
# Usage: scripts/commit.sh "message" -- files...
set -euo pipefail
[ -z "${GIT_INDEX_FILE:-}" ] || { echo 'commit.sh: private indexes are retired' >&2; exit 2; }
[ "$#" -ge 3 ] && [ "$2" = -- ] || { echo 'usage: scripts/commit.sh "message" -- <files...>' >&2; exit 2; }
message=$1; shift 2
cd "$(git rev-parse --show-toplevel)"
for path in "$@"; do
  case "$path" in .|:/|/*|../*|*:*|*\**|*\?*|*\[*) echo "commit.sh: name literal repository files: $path" >&2; exit 2 ;; esac
  [ ! -d "$path" ] || { echo "commit.sh: name files, not directories: $path" >&2; exit 2; }
done
exec python3 - "$message" "$@" <<'PY'
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys

message, *paths = sys.argv[1:]
common = Path(subprocess.check_output(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip())

def expired(*_):
    raise SystemExit('commit.sh: commit lock timed out after five minutes')

signal.signal(signal.SIGALRM, expired)
signal.alarm(300)
with (common / 'commit.lock').open('a') as lease:
    fcntl.flock(lease, fcntl.LOCK_EX)
    signal.alarm(0)
    # Intent-to-add makes new named files available to Git's pathspec commit.
    # Existing stages, including another agent's, remain outside this commit.
    new = []
    for path in paths:
        tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', '--', path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if tracked.returncode != 0 and os.path.lexists(path):
            new.append(path)
    if new:
        subprocess.run(['git', 'add', '--intent-to-add', '--', *new], check=True)
    result = subprocess.run(['git', 'commit', '-F', '-', '--', *paths], input=message, text=True)
    raise SystemExit(result.returncode)
PY
