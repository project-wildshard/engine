"""GM6: exact-run test replay plans; no source checkout occurs in this producer."""
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys

SHA = re.compile(r'[0-9a-f]{40}')
LANES = runpy.run_path(str(Path(__file__).with_name('commit_lane.py')))


def test_path(value):
    return (isinstance(value, str) and
            re.fullmatch(r'(?:src|test|admin/test|drafts/test)/[^\x00-\x1f\x7f\\]+\.(?:test|spec)\.(?:ts|mjs|cjs)', value) is not None and
            not any(part in ('', '.', '..') for part in value.split('/')))


def bisect_plan(root, base, head, run, failures, parallel=18, runner=subprocess.check_output):
    if not all(isinstance(sha, str) and SHA.fullmatch(sha) for sha in (base, head)):
        raise ValueError('Bisect requires exact green and red revisions')
    if not isinstance(run, str) or not re.fullmatch(r'[1-9][0-9]*', run):
        raise ValueError('Bisect requires an exact push run')
    if type(parallel) is not int or not 1 <= parallel <= 18 or not isinstance(failures, list):
        raise ValueError('Invalid bisect parallel inventory')
    files = set()
    for failure in failures:
        if (not isinstance(failure, dict) or failure.get('sha') != head or
                str(failure.get('run')) != run or not isinstance(failure.get('files'), list) or
                any(not isinstance(file, str) for file in failure['files'])):
            raise ValueError('Failure evidence is not from this exact push run')
        files.update(file for file in failure['files'] if test_path(file))
    result = {'schema': 1, 'base': base, 'head': head, 'run': run, 'files': sorted(files),
              'available': False, 'commits': [], 'matrix': {'include': []}}
    if not files:
        return {**result, 'reason': 'No replayable failing test file was retained; original red remains open'}
    if len(files) > 256:
        return {**result, 'reason': 'Failure inventory exceeds 256 suites; no evidence was truncated'}
    environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    def git(*args):
        return runner(['git', *args], cwd=root, env=environment, text=True, timeout=15).strip()
    if git('merge-base', base, head) != base:
        raise ValueError('Last green is not an ancestor of this exact red')
    records = git('log', '-z', '--reverse', '--first-parent', '--format=%H%x00%B', base + '..' + head).split('\0')
    if records and not records[-1]:
        records.pop()
    if len(records) % 2:
        raise ValueError('Invalid exact commit history')
    commits = []
    for index in range(0, len(records), 2):
        sha, message = records[index].strip(), records[index + 1]
        if not SHA.fullmatch(sha):
            raise ValueError('Invalid bisect commit identity')
        commits.append({'sha': sha, 'lane': LANES['commit_lane'](message)})
    if not commits or commits[-1]['sha'] != head or len({row['sha'] for row in commits}) != len(commits):
        raise ValueError('Bisect history does not end at the failed revision')
    if len(commits) > 1000:
        return {**result, 'reason': 'Red window exceeds 1000 commits; no guessed or truncated culprit'}
    groups, offset = [], 0
    count = min(parallel, len(commits))
    for segment in range(count):
        remaining = len(commits) - offset
        size = (remaining + count - segment - 1) // (count - segment)
        selected = commits[offset:offset + size]
        groups.append({'segment': segment, 'offset': offset,
                       'commits': json.dumps([row['sha'] for row in selected]), 'files': json.dumps(sorted(files))})
        offset += size
    return {**result, 'available': True, 'commits': commits, 'matrix': {'include': groups}}


def replay_report(plan, results):
    """Never call a flake, absent result or preparation failure a proved culprit."""
    if not isinstance(plan, dict) or plan.get('schema') != 1 or not plan.get('available'):
        raise ValueError('Missing exact bisect plan')
    expected = [row['sha'] for row in plan['commits']]
    by_sha = {}
    for row in results:
        if (not isinstance(row, dict) or row.get('sha') not in expected or row.get('sha') in by_sha or
                row.get('status') not in ('passed', 'failed', 'absent', 'unavailable')):
            raise ValueError('Invalid or duplicate bisect result')
        by_sha[row['sha']] = row
    if any(sha not in by_sha or by_sha[sha]['status'] == 'unavailable' for sha in expected):
        return {'proved': False, 'reason': 'Replay evidence is incomplete; original red and owner clock remain open'}
    if by_sha[plan['head']]['status'] != 'failed':
        return {'proved': False, 'reason': 'The failed head did not reproduce; no causal fix or clock closure'}
    for commit in plan['commits']:
        if by_sha[commit['sha']]['status'] == 'failed':
            return {'proved': True, 'firstBad': commit['sha'], 'lane': commit['lane'],
                    'base': plan['base'], 'head': plan['head'], 'files': plan['files']}
    raise ValueError('Head failure has no first reproduced bad commit')
