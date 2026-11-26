"""Fail-closed joins for measured command CPU; never infer a full gate from a lease name."""
from datetime import datetime
import hashlib
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
             and census_begin < census_finish,
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


def owned_bytes(path, limit, *, prefix=None, identity=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
             'evidence is not a private owned regular file')
        need(identity is None or (info.st_dev, info.st_ino) == identity, 'evidence rotated while settling')
        need(0 < info.st_size <= limit, 'evidence exceeds its byte budget')
        size = info.st_size if prefix is None else prefix
        need(0 <= size <= info.st_size, 'evidence truncated while settling')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            body = stream.read(size)
        need(len(body) == size, 'evidence changed while reading')
        return body
    finally:
        os.close(fd)


def discover_proof(source, root):
    """Bound directory work; unsafe entries are ineligible, not owner candidates.

    A symlink/unreadable receipt cannot establish an owner even if its target
    would match. Only privately owned regular receipts can make ambiguity.
    A damaged sole matching receipt therefore still leaves no usable match."""
    directory = source.is_dir()
    diagnostics = {'entries': 0, 'bytes': 0, 'malformed': 0, 'unsafe': 0, 'unrelated': 0}
    if directory:
        info = source.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
             'proof directory is not privately owned')
        paths = []
        for path in source.glob('*.json'):
            paths.append(path)
            need(len(paths) <= 4096, 'proof directory exceeds its entry budget')
    else:
        paths = [source]
    candidates = []
    for path in paths:
        diagnostics['entries'] += 1
        # Charge even unreadable/oversized entries against the directory bound.
        try:
            info = path.lstat()
        except OSError:
            if not directory:
                raise
            diagnostics['unsafe'] += 1
            continue
        diagnostics['bytes'] += info.st_size
        need(diagnostics['bytes'] <= 32 * 1024**2,
             'proof directory exceeds its byte budget; select one receipt')
        try:
            body = owned_bytes(path, 2 * 1024**2)
        except (OSError, ValueError):
            if not directory:
                raise
            diagnostics['unsafe'] += 1
            continue
        try:
            proof = json.loads(body)
            need(isinstance(proof, dict), 'proof is not an object')
        except (ValueError, RecursionError):
            if not directory:
                raise
            diagnostics['malformed'] += 1
            continue
        measurement = proof.get('measurement')
        owner = measurement.get('owner') if isinstance(measurement, dict) else None
        if isinstance(owner, dict) and owner.get('identity') == root['identity'] and owner.get('pid') == root['pid']:
            # Once matched, every remaining field is mandatory in join_census.
            candidates.append((path, proof))
        else:
            diagnostics['unrelated'] += 1
    need(len(candidates) == 1, 'missing or ambiguous owner-bound proof')
    return (*candidates[0], diagnostics)


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
        path, proof, diagnostics = discover_proof(Path(proof_source), root)
        evidence['proofDiscovery'] = diagnostics
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


class QualificationReader:
    """Cache discovery while waiting; validate all current evidence once before joining.

    The append fast path cannot prove that old bytes stayed immutable. A final
    complete hash check makes historical rewrites fail closed without rereading
    the prefix on every unrelated append.
    """
    def __init__(self, raw_report, proof_source, command_log, used=()):
        self.raw_report, self.proof_source, self.command_log = map(Path, (raw_report, proof_source, command_log))
        self.used = used
        self.initialized = False
        self.offset, self.tail = 0, b''
        self.log_identity, self.log_stamp = None, None
        self.log_hash = hashlib.sha256()
        self.releases = []
        self.metrics = {'receiptDiscoveries': 0, 'commandLogBytesRead': 0, 'finalValidationPasses': 0}

    def poll(self):
        evidence = {'rawReport': str(self.raw_report), 'proofSource': str(self.proof_source),
                    'commandLog': str(self.command_log)}
        try:
            if not self.initialized:
                raw = owned_bytes(self.raw_report, 64 * 1024**2)
                rows = [json.loads(line) for line in raw.splitlines()]
                need(len(rows) >= 2 and rows[0].get('type') == 'start' and rows[-1].get('type') == 'end',
                     'raw census is incomplete')
                need(sum(row.get('type') == 'start' for row in rows) == 1
                     and sum(row.get('type') == 'end' for row in rows) == 1, 'ambiguous raw census')
                self.raw_hash = hashlib.sha256(raw).digest()
                self.path, self.proof, _ = discover_proof(self.proof_source, rows[0]['root'])
                proof_bytes = owned_bytes(self.path, 2 * 1024**2)
                need(json.loads(proof_bytes) == self.proof, 'producer proof changed during discovery')
                self.proof_hash = hashlib.sha256(proof_bytes).digest()
                self.metrics['receiptDiscoveries'] += 1
                self.token = self.proof['measurement']['lease']['token']
                need(isinstance(self.token, str) and self.token, 'producer lease missing')
                self.initialized = True
            evidence['proofFile'] = str(self.path)
            fd = os.open(self.command_log, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                info = os.fstat(fd)
                need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
                     'command log is not a private owned regular file')
                need(0 <= info.st_size <= 128 * 1024**2, 'command log exceeds its byte budget')
                identity = (info.st_dev, info.st_ino)
                stamp = info.st_mtime_ns
                need(self.log_identity is None or self.log_identity == identity, 'command log rotated while settling')
                need(info.st_size >= self.offset, 'command log truncated while settling')
                need(info.st_size != self.offset or self.log_stamp is None or stamp == self.log_stamp,
                     'command log changed without append')
                os.lseek(fd, self.offset, os.SEEK_SET)
                with os.fdopen(fd, 'rb', closefd=False) as stream:
                    new = stream.read(info.st_size - self.offset)
                need(len(new) == info.st_size - self.offset, 'command log changed while reading')
                self.log_identity, self.log_stamp = identity, stamp
                self.offset = info.st_size
                self.metrics['commandLogBytesRead'] += len(new)
                self.log_hash.update(new)
                lines = (self.tail + new).split(b'\n')
                self.tail = lines.pop()
                for line in lines:
                    row = json.loads(line)
                    if row.get('event') == 'release' and row.get('token') == self.token:
                        self.releases.append(row)
            finally:
                os.close(fd)
            need(len(self.releases) <= 1, 'ambiguous lease release')
            if not self.releases or self.tail:
                return {'qualified': False, 'pending': True,
                        'reason': 'command log has an incomplete tail' if self.tail else 'owned command release has not been published',
                        'evidence': evidence, 'settling': dict(self.metrics)}
            # No cached identity or prefix is sufficient for a positive verdict.
            # Revalidate once at publication, including directory ambiguity and all bounds.
            need(hashlib.sha256(owned_bytes(self.raw_report, 64 * 1024**2)).digest() == self.raw_hash,
                 'raw census changed while settling')
            need(hashlib.sha256(owned_bytes(self.path, 2 * 1024**2)).digest() == self.proof_hash,
                 'producer proof changed while settling')
            need(hashlib.sha256(owned_bytes(self.command_log, 128 * 1024**2, prefix=self.offset,
                                                  identity=self.log_identity)).digest() == self.log_hash.digest(),
                 'command log history changed while settling')
            current = self.command_log.lstat()
            need((current.st_dev, current.st_ino) == self.log_identity, 'command log rotated before final validation')
            self.metrics['finalValidationPasses'] += 1
            result = qualify_files(self.raw_report, self.proof_source, self.command_log, self.used)
            self.metrics['receiptDiscoveries'] += 1
            result['settling'] = dict(self.metrics)
            return result
        except (OSError, KeyError, TypeError, ValueError, OverflowError, AttributeError, RecursionError) as error:
            return {'qualified': False, 'reason': str(error) or type(error).__name__,
                    'evidence': evidence, 'settling': dict(self.metrics)}
