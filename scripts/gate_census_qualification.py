"""Fail-closed joins for measured command CPU; never infer a full gate from a lease name."""
from datetime import datetime
import json
import math
import os
from pathlib import Path
import stat


class Unqualified(ValueError):
    pass


def need(condition, reason):
    if not condition:
        raise Unqualified(reason)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def pid(value):
    return type(value) is int and 1 < value < 2**31


def timestamp(value):
    need(isinstance(value, str), 'producer timestamp missing')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    need(parsed.tzinfo is not None, 'producer timestamp has no timezone')
    return parsed.timestamp()


def join_census(start, end, proof, release, used=()):
    """All inputs are retained producer records. Only this decision and its exact keys are new."""
    try:
        need(start['schema'] == 'engine-cpu-census/1' and start['type'] == 'start', 'unknown raw census')
        need(end['type'] == 'end' and end['reason'] == 'observed tree drained', 'observed tree did not drain')
        need(end['rootMeasured'] is True and end['remaining'] == [], 'incomplete census or remaining observed children')
        identity_misses, counter_misses, misses = end['identityReadsIncomplete'], end['counterReadsIncomplete'], end['incompleteReads']
        need(all(type(value) is int and value >= 0 for value in (identity_misses, counter_misses, misses))
             and misses == identity_misses + counter_misses, 'incomplete census read classification')
        need(type(end['unresolvedIdentityReads']) is int and end['unresolvedIdentityReads'] == 0,
             'census owner identities remain unresolved')
        root = start['root']
        need(pid(root['pid']) and root['identity'] == start['expectedRootIdentity'], 'selected kernel owner changed')
        need(type(root['uid']) is int and root['uid'] >= 0 and root['zombie'] is False, 'invalid census owner')
        need(isinstance(root['identity'], str) and root['identity'], 'kernel owner identity missing')
        machine = start['machine']
        need(isinstance(machine, str) and machine, 'census machine missing')
        need(proof['version'] == 2 and proof['mode'] == 'full' and proof['exclusions']['files'] == [],
             'producer did not prove complete full scope')
        measurement = proof['measurement']
        need(measurement['profile'] == 'full-v1', 'producer profile is split or unverified')
        need(machine == measurement['machine'] == release['machine'], 'producer machine differs')
        owner = measurement['owner']
        need(type(owner['uid']) is int and owner['pid'] == root['pid']
             and owner['identity'] == root['identity'] and owner['uid'] == root['uid'],
             'proof owner differs from census kernel owner')
        lease = measurement['lease']
        need(isinstance(lease['token'], str) and lease['token'], 'producer lease token missing')
        need(release['schema'] == 'full-test-day/1' and release['event'] == 'release', 'missing command release')
        need(pid(release['pid']) and pid(lease['runnerPid']) and release['token'] == lease['token']
             and release['pid'] == lease['runnerPid'], 'lease owner differs')
        need(isinstance(release['resources'], list) and release['resources'] == lease['resources']
             and 'full-test' in release['resources'], 'producer lease resources differ')
        usage = release['commandUsage']
        need(usage['schema'] == 'command-rusage/1' and usage['state'] == 'measured', 'command counters unavailable')
        need(usage['scope'] == 'owned-child-and-descendants-reaped-by-it', 'unknown command CPU scope')
        need(usage['source'] == 'RUSAGE_CHILDREN delta around sole owned-child wait', 'unknown command counter source')
        need(usage['reaped'] is True and type(usage['exitCode']) is int and usage['exitCode'] == 0
             and type(release['exitCode']) is int and release['exitCode'] == 0, 'command or wrapper failed')
        need(pid(lease['childPid']) and usage['pid'] == lease['childPid'] == root['pid']
             and root['parent'] == lease['runnerPid'], 'census is not the directly owned command')
        need(type(usage['uid']) is int and usage['identity'] == root['identity']
             and usage['uid'] == root['uid'], 'command kernel owner differs')
        need(start['platform'] in ('darwin', 'linux') and start['platform'] == usage['platform'] == measurement['platform'],
             'producer platform differs')
        # Linux's born_ns is an epoch estimate; its authoritative identity is
        # boot ID + PID + kernel start ticks. Never compare rounded epoch estimates.
        begin, finish = usage['startedAt'], usage['reapedAt']
        need(number(start['startedAtMs']) and number(end['endedAtMs']), 'invalid census lifetime')
        census_begin, census_finish = start['startedAtMs'] / 1000, end['endedAtMs'] / 1000
        need(all(number(v) for v in (begin, finish, census_begin, census_finish, usage['wallSeconds'],
                                     lease['queuedAt'], lease['startedAt'])), 'invalid producer lifetime')
        # Drain proves actual reap; the parent's post-wait bookkeeping can be
        # descheduled until after the observer ends. Neither timestamp is padded.
        need(lease['queuedAt'] <= lease['startedAt'] <= begin <= census_begin <= finish
             and census_begin <= census_finish,
             'producer lifetimes do not contain this observation')
        need(usage['wallSeconds'] > 0 and finish > begin > 0, 'invalid command wall interval')
        captured, published = timestamp(measurement['captured']), timestamp(proof['finished'])
        need(begin <= captured <= published <= finish and census_begin <= published <= census_finish,
             'proof is stale or outside its command or observed lifetime')
        need(number(proof['seconds']) and 0 <= proof['seconds'] <= usage['wallSeconds'], 'invalid proof wall')
        user, system = usage['userSeconds'], usage['systemSeconds']
        need(number(user) and number(system) and user >= 0 and system >= 0 and math.isfinite(user + system),
             'invalid command CPU')
        run = proof['run']
        need(isinstance(run, str) and run, 'producer run identity missing')
        proof_key = f'proof:{machine}:{run}'
        command_key = f"command:{machine}:{lease['token']}:{root['identity']}"
        need(proof_key not in used and command_key not in used, 'producer or command already accounted')
        return {'qualified': True, 'proofKey': proof_key, 'commandKey': command_key,
                'proofRun': run, 'leaseToken': lease['token'], 'kernelIdentity': root['identity'],
                'machine': machine, 'userSeconds': user, 'systemSeconds': system,
                'cpuSeconds': user + system, 'commandWallSeconds': usage['wallSeconds'],
                'scope': usage['scope'], 'sampledCounterReadMisses': counter_misses,
                'sampledIdentityReadMisses': identity_misses,
                'sampling': 'Observed CPU/parallelism remain sampled lower bounds; censored counters never supply command CPU.'}
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        return {'qualified': False, 'reason': str(error) or type(error).__name__}


def owned_bytes(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
             'evidence is not a private owned regular file')
        need(0 < info.st_size <= limit, 'evidence exceeds its byte budget')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            body = stream.read(info.st_size)
        need(len(body) == info.st_size, 'evidence changed while reading')
        return body
    finally:
        os.close(fd)


def qualify_files(raw_report, proof_source, command_log, used=()):
    """A receipt file or one bounded cache directory; shared logs may append after this snapshot."""
    evidence = {'rawReport': str(raw_report), 'proofSource': str(proof_source), 'commandLog': str(command_log)}
    try:
        rows = [json.loads(line) for line in owned_bytes(raw_report, 64 * 1024**2).splitlines()]
        need(len(rows) >= 2 and rows[0].get('type') == 'start' and rows[-1].get('type') == 'end',
             'raw census is incomplete')
        need(sum(row.get('type') == 'start' for row in rows) == 1
             and sum(row.get('type') == 'end' for row in rows) == 1, 'ambiguous raw census')
        start, end = rows[0], rows[-1]
        root = start['root']
        source = Path(proof_source)
        if source.is_dir():
            info = source.lstat()
            need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
                 'proof directory is not privately owned')
            paths = []
            for path in source.glob('*.json'):
                paths.append(path)
                need(len(paths) <= 4096, 'proof directory exceeds its entry budget')
        else:
            paths = [source]
        candidates, byte_count = [], 0
        for path in paths:
            body = owned_bytes(path, 2 * 1024**2)
            byte_count += len(body)
            need(byte_count <= 32 * 1024**2, 'proof directory exceeds its byte budget; select one receipt')
            proof = json.loads(body)
            measurement = proof.get('measurement')
            if not isinstance(measurement, dict) or not isinstance(measurement.get('owner'), dict):
                continue
            owner = measurement['owner']
            if owner.get('identity') == root['identity'] and owner.get('pid') == root['pid']:
                candidates.append((path, proof))
        need(len(candidates) == 1, 'missing or ambiguous owner-bound proof')
        path, proof = candidates[0]
        lease = proof['measurement']['lease']
        need(isinstance(lease, dict) and isinstance(lease.get('token'), str), 'producer lease missing')
        releases = []
        for line in owned_bytes(command_log, 128 * 1024**2).splitlines():
            row = json.loads(line)
            if row.get('event') == 'release' and row.get('token') == lease['token']:
                releases.append(row)
        if not releases:
            return {'qualified': False, 'pending': True, 'reason': 'owned command release has not been published',
                    'evidence': {**evidence, 'proofFile': str(path)}}
        need(len(releases) == 1, 'missing or ambiguous lease release')
        result = join_census(start, end, proof, releases[0], used)
        result['evidence'] = {**evidence, 'proofFile': str(path)}
        return result
    except (OSError, KeyError, TypeError, ValueError, OverflowError, AttributeError, RecursionError) as error:
        return {'qualified': False, 'reason': str(error) or type(error).__name__, 'evidence': evidence}
