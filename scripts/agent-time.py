#!/usr/bin/env python3
"""The build-speed audit numbers on demand (BUILD-SPEED 1.4 A3, E491). Read-only.

    python3 scripts/agent-time.py [--hours N]      (default 24)

Prints, for the window: agent tool-hours by category for Claude and Codex (from their transcripts), the poll share
(Codex wait/sleep calls, Claude pause/poll commands), the live push loop (.git/push.log), build-slot queue, transcript waits, CI red windows,
resource reaps, machine sample, usage budgets and commit mix
(git log). Every wave's Verify in docs/plans/BUILD-SPEED.md is one run of this script.
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import re
import statistics
import subprocess
import time
from collections import Counter, defaultdict
from pathlib import Path

RULES = [
    ('heavy-lane', r'heavy-lane\.py'), ('sim-lane', r'sim-lane\.sh'), ('browser-lane', r'browser-lane\.sh'),
    ('build-mirror', r'build-mirror\.mjs'), ('push', r'push-main\.sh|git push'), ('quiet', r'quiet-cli|\.git/quiet'),
    ('serve-build', r'serve-build\.sh'), ('proof-run', r'proof-run\.sh'),
    ('pause/poll', r'(^|[;&|]\s*)sleep\s+\d|\bwait\b|until .*; do'),
    ('git commit', r'git commit'), ('git other', r'\bgit\b'), ('vitest', r'vitest|pnpm test'),
    ('types/lint', r'\btsc\b|pnpm types|oxlint|pnpm lint'), ('build', r'pnpm build|vite build'),
    ('browser', r'playwright|agent-browser|chromium'), ('herdr', r'\bherdr\b'), ('node script', r'\bnode (scripts/|tmp/)'),
    ('python', r'python3?'), ('read', r'^\s*(cat|ls|grep|rg|head|tail|sed -n|wc|find|jq|stat|du|df)\b'),
]


def category(command):
    for name, pattern in RULES:
        if re.search(pattern, command, re.M):
            return name
    return 'other'


def parse_time(value):
    return dt.datetime.fromisoformat(re.sub(r'([+-]\d{2})(\d{2})$', r'\1:\2', value.replace('Z', '+00:00')))


def claude(cut, root, observations=None):
    hours = defaultdict(float)
    counts = Counter()
    turns = cache_read = 0
    for path in glob.glob(root + '/**/*.jsonl', recursive=True):
        if dt.datetime.fromtimestamp(os.path.getmtime(path), dt.timezone.utc) < cut:
            continue
        pending = {}
        with open(path, errors='replace') as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                stamp = record.get('timestamp')
                if not stamp:
                    continue
                at = parse_time(stamp)
                if at < cut:
                    continue
                message = record.get('message') or {}
                content = message.get('content') if isinstance(message.get('content'), list) else []
                if record.get('type') == 'assistant':
                    turns += 1
                    cache_read += (message.get('usage') or {}).get('cache_read_input_tokens', 0) or 0
                    for item in content:
                        if item.get('type') == 'tool_use':
                            name = item.get('name')
                            if name == 'Bash':
                                command = (item.get('input') or {}).get('command', '')
                                name = 'Bash:' + category(command)
                                if observations is not None:
                                    observations['commands'][item.get('id')] = command
                            pending[item.get('id')] = (name, at)
                            counts[name] += 1
                elif record.get('type') == 'user':
                    for item in content:
                        if item.get('type') == 'tool_result' and item.get('tool_use_id') in pending:
                            name, started = pending.pop(item['tool_use_id'])
                            seconds = (at - started).total_seconds()
                            if 0 <= seconds <= 7200:
                                hours[name] += seconds / 3600
                                if observations is not None:
                                    observe_output(observations, item.get('content', ''))
                                    command = observations['commands'].pop(item.get('tool_use_id'), '')
                                    if re.search(r'build-mirror\.mjs|serve-build\.sh.*--rev|tmp/[^\s]*check[^\s]*\.(?:sh|py)', command):
                                        observations['opusMirrorHours'] += seconds / 3600
    return hours, counts, turns, cache_read


def codex(cut, root, observations=None, repo=None):
    hours = defaultdict(float)
    counts = Counter()
    compactions = sessions = 0
    for path in glob.glob(root + '/*/*/*/*.jsonl'):
        if dt.datetime.fromtimestamp(os.path.getmtime(path), dt.timezone.utc) < cut:
            continue
        sessions += 1
        pending = {}
        with open(path, errors='replace') as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if record.get('type') == 'session_meta' and repo is not None and (record.get('payload') or {}).get('cwd') != repo:
                    sessions -= 1
                    break
                stamp = record.get('timestamp')
                if not stamp:
                    continue
                at = parse_time(stamp)
                if at < cut:
                    continue
                kind = record.get('type')
                payload = record.get('payload') or {}
                if kind == 'compacted':
                    compactions += 1
                if kind != 'response_item':
                    continue
                item_type = payload.get('type')
                if item_type == 'custom_tool_call' and payload.get('name') == 'exec':
                    command = payload.get('input') or ''
                    name = 'exec:' + category(command if isinstance(command, str) else json.dumps(command))
                    pending[payload.get('call_id')] = (name, at)
                    counts[name] += 1
                elif item_type == 'function_call':
                    name = 'fn:' + str(payload.get('name'))
                    pending[payload.get('call_id')] = (name, at)
                    counts[name] += 1
                elif item_type in ('custom_tool_call_output', 'function_call_output'):
                    call = payload.get('call_id')
                    if observations is not None:
                        observe_output(observations, payload.get('output', ''))
                    if call in pending:
                        name, started = pending.pop(call)
                        seconds = (at - started).total_seconds()
                        if 0 <= seconds <= 7200:
                            hours[name] += seconds / 3600
    return hours, counts, sessions, compactions


def rows(path, since):
    out = []
    try:
        with open(path) as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if isinstance(record, dict) and isinstance(record.get('at') or record.get('startedAt') or 0, (int, float)) and (record.get('at') or record.get('startedAt') or 0) >= since:
                    out.append(record)
    except OSError:
        pass
    return out


def quantiles(values, digits=0):
    if not values:
        return 'n=0'
    values = sorted(values)
    return 'n=%d med=%.*f p90=%.*f max=%.*f' % (len(values), digits, statistics.median(values), digits, values[int(len(values) * 0.9)], digits, values[-1])


def commit_timing_rows(path, since):
    """Read actual wrapper completions, including refusals; never scrape quoted logs."""
    try:
        contents = path.read_text()
    except OSError as error:
        return [], 0, type(error).__name__
    accepted, ignored = {}, 0
    for line in contents.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            ignored += 1
            continue
        if not isinstance(row, dict) or type(row.get('at')) not in (int, float) or not math.isfinite(row['at']):
            ignored += 1
            continue
        if row['at'] < since:
            continue
        values = [row.get(name) for name in ('elapsedMs', 'waitMs', 'workMs')]
        if (type(row.get('version')) is not int or row['version'] != 1 or 'exitCode' not in row or not isinstance(row.get('id'), str) or not row['id']
                or any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in values)
                or abs(values[0] - values[1] - values[2]) > 1
                or row.get('exitCode') is not None and type(row['exitCode']) is not int
                or 'lockMs' in row and (type(row['lockMs']) not in (int, float) or not math.isfinite(row['lockMs'])
                                       or row['lockMs'] < 0 or row['lockMs'] > values[2] + 1)
                or row['id'] in accepted):
            ignored += 1
            continue
        accepted[row['id']] = row
    return list(accepted.values()), ignored, None


def commit_timing_reading(path, since):
    samples, ignored, error = commit_timing_rows(path, since)
    if error:
        return 'unavailable: ' + error + ' (wrapper timing ledger)'
    parts = [name + ' seconds ' + quantiles([row[field] / 1000 for row in samples], 2)
             for name, field in [('total', 'elapsedMs'), ('wait', 'waitMs'), ('work', 'workMs')]]
    parts.append('successful total seconds ' + quantiles(
        [row['elapsedMs'] / 1000 for row in samples if row['exitCode'] == 0], 2))
    parts.append('lock held seconds ' + quantiles([row.get('lockMs', row['workMs']) / 1000 for row in samples], 2)
                 + ' (legacy work was entirely serialized)')
    parts.append('refused %d; unknown outcome %d; ignored invalid/duplicate %d; actual wrapper completions only' % (
        sum(row['exitCode'] is not None and row['exitCode'] != 0 for row in samples),
        sum(row['exitCode'] is None for row in samples), ignored))
    return '; '.join(parts)


def observe_output(reading, output):
    """Count tool-result observations, not quoted tool commands or prompts."""
    if isinstance(output, list):
        for item in output:
            observe_output(reading, item)
        return
    if isinstance(output, dict):
        for key in ('text', 'output', 'content'):
            if key in output:
                observe_output(reading, output[key])
        return
    if not isinstance(output, str):
        return
    try:
        decoded = json.loads(output)
    except ValueError:
        decoded = None
    if isinstance(decoded, (dict, list)):
        observe_output(reading, decoded)
        return
    for line in output.splitlines():
        if re.search(r'timed out after 5 min|admission timed out|timed out after 300s|5-min.*timeout', line, re.I):
            kind = next((name for name in ('mirror', 'heavy-lane', 'sim-lane', 'browser-lane', 'preview', 'commit') if name in line), 'other')
            reading['timeouts'][kind] += 1
        match = re.search(r'heavy-lane: acquired .*? after ([\d.]+)s queue', line)
        if match is not None:
            reading['queueSeconds'].append(float(match[1]))


def push_rows(path, since):
    result = []
    try:
        with open(path) as source:
            for line in source:
                try:
                    stamp, payload = line.strip().split(' ', 1)
                    at = parse_time(stamp).timestamp()
                    row = json.loads(payload)
                    if at >= since and isinstance(row, dict):
                        result.append({**row, 'at': at})
                except (ValueError, TypeError):
                    continue
    except OSError:
        pass
    return result


def ci_red_intervals(runs, since, now):
    """Failed push creation to the next later green push's completion."""
    verdicts = sorted((parse_time(row['createdAt']).timestamp(),
                       parse_time(row['updatedAt']).timestamp(), row['conclusion'])
                      for row in runs if row.get('event') == 'push' and row.get('status') == 'completed'
                      and row.get('conclusion') in ('success', 'failure', 'timed_out', 'action_required', 'startup_failure'))
    windows, opened = [], None
    for created, completed, conclusion in verdicts:
        if created > now or completed > now:
            continue
        if conclusion == 'success':
            if opened is not None and completed > since:
                windows.append((max(since, opened), completed))
            opened = None
        elif opened is None:
            opened = created
    if opened is not None and now > max(since, opened):
        windows.append((max(since, opened), now))
    return windows


def ci_windows(runs, since, now):
    """Keep individual windows, including repairs that overlap in flight."""
    return [end - start for start, end in ci_red_intervals(runs, since, now)]


def ci_red_seconds(runs, since, now):
    """The total red time counts overlapping windows only once."""
    total, covered_until = 0, since
    for start, end in ci_red_intervals(runs, since, now):
        total += max(0, end - max(start, covered_until))
        covered_until = max(covered_until, end)
    return total


def command(args, cwd=None, timeout=15):
    """Bounded, read-only external samples; no shell or retry."""
    try:
        result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=timeout)
        if result.returncode == 0:
            return result.stdout.strip(), None
        return '', '%s exited %d' % (args[0], result.returncode)
    except (OSError, subprocess.TimeoutExpired) as error:
        return '', '%s: %s' % (args[0], type(error).__name__)


def json_command(args, cwd=None):
    text, error = command(args, cwd)
    if error is not None:
        return None, error
    try:
        return json.loads(text), None
    except ValueError:
        return None, args[0] + ': invalid JSON'


def reaps(path, since):
    count = 0
    try:
        with open(path) as source:
            for line in source:
                try:
                    # The lane logs use local wall time, unlike push.log's offset.
                    at = dt.datetime.strptime(line[:19], '%Y-%m-%d %H:%M:%S').astimezone().timestamp()
                    count += at >= since
                except ValueError:
                    continue
    except OSError:
        return 'unavailable'
    return str(count)


def file_count(path, seconds=2):
    count, deadline = 0, time.monotonic() + seconds
    if not os.path.isdir(path):
        return 'unavailable'
    for _, _, files in os.walk(path):
        count += len(files)
        if time.monotonic() >= deadline:
            return '>=%d (sample capped)' % count
    return str(count)


def publication_seconds(pushes, commits, order):
    """One main-chain order maps a pushed tip to all its earlier commits."""
    published = [(row['at'], order[row['tip']]) for row in pushes
                 if row.get('status') == 'pushed' and row.get('tip') in order]
    return [min(at - row['at'] for at, index in published if index <= order[row['sha']] and at >= row['at'])
            for row in commits if row.get('sha') in order and
            any(index <= order[row['sha']] and at >= row['at'] for at, index in published)]


def git_common(repo):
    """The common Git dir every linked worktree shares (DEV-SPEED DS6)."""
    text, _ = command(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], repo)
    return Path(text.strip()) if text.strip() else Path(repo) / '.git'


def print_reading(repo, since, observations):
    home = Path.home()
    common = git_common(repo)
    pushes = push_rows(common / 'push.log', since)
    gates = [row for row in pushes if isinstance(row.get('gateSeconds'), (int, float))]
    builds = rows(home / '.wildshard-heavy-lanes/build-day.log', since)
    builds = [row for row in builds if isinstance(row.get('buildSeconds'), (int, float))]
    order_text, _ = command(['git', 'rev-list', 'main'], repo)
    order = {sha:index for index, sha in enumerate(order_text.splitlines())}
    published = publication_seconds(pushes, rows(common / 'commit-lanes.jsonl', since), order)
    now = time.time()
    created = dt.datetime.fromtimestamp(since - 6 * 3600, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    runs, ci_error = json_command(['gh','run','list','--workflow','deploy','--limit','1000','--created','>='+created,
                                  '--json','conclusion,createdAt,updatedAt,status,event'], repo)
    ci = 'unavailable: ' + ci_error if ci_error else '%d red windows, %.2f h red, %d over 30 min; longest %.1f min' % (
        len(windows := ci_windows(runs, since, now)), ci_red_seconds(runs, since, now)/3600,
        sum(value > 1800 for value in windows), max(windows, default=0)/60)
    ci += '; cancelled %d, pending/running %d' % (sum(row.get('conclusion') == 'cancelled' for row in runs if parse_time(row['createdAt']).timestamp() >= since),
             sum(row.get('status') != 'completed' for row in runs if parse_time(row['createdAt']).timestamp() >= since)) if runs is not None else ''
    log, _ = command(['git','log','--since=@%d'%since,'--format=%s'], repo)
    reverts = sum(bool(re.match(r'revert\b', line, re.I)) for line in log.splitlines())
    status, _ = command(['git','status','--porcelain'], repo)
    machine = []
    for args in (['uptime'], ['top','-l','1','-n','0'], ['sysctl','vm.swapusage'], ['df','-h','/']):
        text, error = command(args, timeout=5)
        if args[0] == 'top':
            text = '; '.join(line for line in text.splitlines() if line.startswith(('CPU usage:', 'PhysMem:')))
        if args[0] == 'df':
            text = text.splitlines()[-1] if text else ''
        machine.append(error or text.replace('\n', '; '))
    processes, error = command(['ps','-Ao','pcpu=,rss=,etime=,comm=','-r'])
    machine.append(error or 'top processes: ' + '; '.join(processes.splitlines()[:4]))
    usage, usage_error = json_command(['openusage'])
    budgets = []
    if isinstance(usage, dict):
        for name, provider in usage.get('providers', {}).items():
            resources = provider.get('resources', {})
            parts = ['%s %s%% used; reset %s' % (kind, resources[kind].get('used'), resources[kind].get('resetsAt'))
                     for kind in ('weekly','fable') if kind in resources]
            if 'credits' in resources:
                parts.append('credits %s' % resources['credits'].get('available'))
            budgets.append('%s: %s%s' % (name, ', '.join(parts), ' (stale)' if provider.get('stale') else ''))
    queue = Path(repo) / 'project/archive/2026-11-04-shard-platform/lanes/sim-queue.md'
    try:
        open_sim = sum('| open' in line or '| in flight' in line for line in queue.read_text().splitlines())
    except OSError:
        open_sim = 'unavailable'
    print('\n| Shared resource | Reading (current window; missing inputs remain explicit) |')
    print('|---|---|')
    table = [
        ('Push gate', '%d timed ticks, %d red; gate seconds %s; quiet ticks %d' % (len(gates), sum(row.get('status') == 'red' for row in pushes), quantiles([row['gateSeconds'] for row in gates]), sum(row.get('status') == 'quiet' for row in pushes))),
        ('Commit to origin', 'seconds %s (reachable ledger commits)' % quantiles(published)),
        ('Commit invocation', commit_timing_reading(common / 'commit-times.jsonl', since)),
        ('CI / red main', ci + '; reverts %d (G674 fix-forward only)' % reverts),
        ('Build mirror', 'Opus command hours %.2f; no mirror occupancy log' % observations['opusMirrorHours']),
        ('Heavy builds', '%d completed; queue seconds %s; build seconds %s; transcript queues >60 s: %d' % (len(builds), quantiles([row['queueSeconds'] for row in builds]), quantiles([row['buildSeconds'] for row in builds]), sum(value > 60 for value in observations['queueSeconds'])) + ('; historical log expiry left a gap' if not builds else '')),
        ('Five-minute waits', str(dict(observations['timeouts'])) + ' (tool-output observations; re-read logs can repeat)'),
        ('Full-test lane', 'CI only; local full suite remains refused'),
        ('Simulator / browsers', 'reap log lines: sim %s, browsers %s; open Simulator rows %s' % (reaps(home/'.sim-lane/reap.log', since), reaps(home/'.browser-lane/reap.log', since), open_sim)),
        ('Commit lock / tree', 'transcript timeouts %d; dirty paths %d' % (observations['timeouts']['commit'], len(status.splitlines()))),
        ('Generated inputs', 'push types statuses %s' % dict(Counter(row['types'] for row in pushes if 'types' in row))),
        ('Machine', '; '.join(machine)),
        ('Temporary files', '/private/tmp %s; TMPDIR %s' % (file_count('/private/tmp'), file_count(os.environ.get('TMPDIR', '/tmp')))),
        ('Budgets', usage_error or '; '.join(budgets) or 'unavailable'),
    ]
    for name, value in table:
        print('| %s | %s |' % (name, value.replace('|','/').replace('\n',' ')))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--hours', type=float, default=24)
    args = parser.parse_args()
    if args.hours <= 0:
        parser.error('--hours must be positive')
    cut = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=args.hours)
    since = time.time() - args.hours * 3600
    repo = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
    print('window: last %.0f h, to %s' % (args.hours, dt.datetime.now().strftime('%Y-%m-%d %H:%M')))

    claude_root = os.path.expanduser('~/.claude/projects/' + repo.replace('/', '-'))
    observations = {'commands': {}, 'timeouts': Counter(), 'queueSeconds': [], 'opusMirrorHours': 0.0}
    hours, counts, turns, cache_read = claude(cut, claude_root, observations)
    total = sum(hours.values())
    poll = sum(v for k, v in hours.items() if k.startswith('Bash:pause/poll'))
    print('\nClaude: %d assistant turns, %.2fB cache-read tokens, %.1f tool-hours, poll share %.0f%%' % (
        turns, cache_read / 1e9, total, 100 * poll / total if total else 0))
    for name, value in sorted(hours.items(), key=lambda pair: -pair[1])[:10]:
        print('  %-32s %6.2f h  n=%d' % (name, value, counts[name]))

    hours, counts, sessions, compactions = codex(cut, os.path.expanduser('~/.codex/sessions'), observations, repo)
    total = sum(hours.values())
    poll = sum(v for k, v in hours.items() if k in ('fn:wait', 'fn:sleep', 'fn:wait_agent') or k == 'exec:pause/poll')
    print('\nCodex: %d sessions, %d compactions, %.1f tool-hours, poll share %.0f%%' % (
        sessions, compactions, total, 100 * poll / total if total else 0))
    for name, value in sorted(hours.items(), key=lambda pair: -pair[1])[:10]:
        print('  %-32s %6.2f h  n=%d' % (name, value, counts[name]))

    print_reading(repo, since, observations)

    log = subprocess.check_output(['git', 'log', '--since=%.0f hours ago' % args.hours, '--format=%h%x00%s%x00%b%x01'],
                                  cwd=repo, text=True)
    commits = [entry for entry in log.split('\x01') if entry.strip()]
    kinds = Counter(re.sub(r'\(.*', '', entry.split('\x00')[1].split(':')[0]) for entry in commits)
    agents = Counter((re.search(r'Assisted-by: *([^:\n]+):', entry) or [None, 'human'])[1] for entry in commits)
    print('\ncommits: %d  by kind %s  by agent %s' % (len(commits), dict(kinds.most_common(6)), dict(agents)))
    print('load now: %s' % ' '.join('%.0f' % value for value in os.getloadavg()))


if __name__ == '__main__':
    main()
