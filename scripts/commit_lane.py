"""GM6: persist lane names, rather than nullable terminal-pane metadata."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

NAME = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,63}')


def commit_lane(message, explicit=None):
    if not isinstance(message, str):
        raise ValueError('Missing exact commit message')
    if explicit is not None:
        if not isinstance(explicit, str) or not NAME.fullmatch(explicit):
            raise ValueError('Invalid explicit commit lane')
        return explicit
    agents = set(re.findall(r'^Assisted-by:[ \t]*([A-Za-z][A-Za-z0-9_-]{0,63}):[^\r\n]+$', message, re.M))
    if len(agents) > 1:
        raise ValueError('Ambiguous assisted commit lanes')
    return next(iter(agents)) if agents else 'human'


def record_commit(path, environment=None, runner=subprocess.check_output, clock=time.time):
    environment = dict(os.environ) if environment is None else environment
    output = runner(['git', 'show', '-s', '--format=%H%x00%B', 'HEAD'], text=True, env=environment)
    sha, separator, message = output.partition('\0')
    if separator != '\0' or not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Missing exact committed revision')
    lane = 'human' if environment.get('SKIP_ATTRIB') == '1' else commit_lane(message, environment.get('WS_COMMIT_LANE'))
    row = {'sha': sha, 'pane': environment.get('HERDR_PANE_ID'), 'lane': lane, 'at': int(clock())}
    with Path(path).open('a') as stream:
        stream.write(json.dumps(row, separators=(',', ':')) + '\n')
    return row


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Expected the existing commit-lane ledger path')
    record_commit(sys.argv[1])
