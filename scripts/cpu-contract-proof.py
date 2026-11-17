#!/usr/bin/env python3
"""CPU tooling contracts against a private kernel and clock, never host load.

The corresponding *-proof.py commands retain real-process qualification.
This runner drives the production functions; only OS/clock/storage boundaries
are replaced. A forbidden host census or signal fails the test immediately.
"""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import sys
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('admission', Path(__file__).with_name('cpu-admission.py'))
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)
owned = admission.owned_command


def check(value, message):
    if not value:
        raise AssertionError(message)


def refuses(action, kind=RuntimeError):
    try:
        action()
    except kind:
        return
    raise AssertionError('expected refusal: ' + kind.__name__)


class Kernel:
    def __init__(self):
        self.rows = {}
        self.zombies = set()
        self.signals = []
        self.now = 100.0
        self.state = {}
        self.add(50, 1)
        self.add(100, 50)
        self.add(110, 100)
        self.add(120, 110)
        self.add(121, 120, group=120)

    def add(self, pid, parent, group=None):
        record = dict(pid=pid, parent=parent, group=group or pid,
                      identity='fixture:' + str(pid), uid=os.getuid())
        self.rows[pid] = record
        return record

    def process(self, pid):
        if pid not in self.rows:
            raise ProcessLookupError(3, 'fixture process absent')
        return SimpleNamespace(**self.rows[pid], zombie=pid in self.zombies)

    def processes(self):
        return ({pid: self.process(pid) for pid in self.rows}, set(self.rows))

    def group(self, pid):
        return self.process(pid).group

    def killpg(self, group, kind):
        members = [pid for pid, row in self.rows.items() if row['group'] == group]
        if not members:
            raise ProcessLookupError(3, 'fixture group absent')
        if kind == 0:
            return
        self.signals.append((group, kind))
        # The descendant ignores TERM; the root exits. Reclaim must retain
        # its row and authenticate the descendant before escalation.
        for pid in members:
            if kind == signal.SIGKILL or pid == group:
                del self.rows[pid]

    @contextlib.contextmanager
    def scheduler(self, *_args):
        yield self.state

    def entry(self, token='owned', slots=2):
        return dict(token=token, pid=110, holder=110, owner=100,
                    repo=str(Path.cwd()), slots=slots,
                    ownedCommand=dict(schema=owned.SCHEMA, provider=copy.copy(self.rows[110]),
                                      caller=copy.copy(self.rows[100]), child=copy.copy(self.rows[120])))

    @contextlib.contextmanager
    def installed(self):
        with contextlib.ExitStack() as stack:
            for target, name, value in [
                (owned, 'identity_backend', lambda: self),
                (owned.os, 'getpgid', self.group),
                (owned.os, 'getpid', lambda: 110),
                (owned.os, 'getppid', lambda: 100),
                (owned.os, 'killpg', self.killpg),
                (owned.os, 'kill', lambda *_: (_ for _ in ()).throw(AssertionError('unexpected PID signal'))),
                (owned.time, 'monotonic', lambda: self.now),
                (owned.subprocess, 'Popen', lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('unexpected host process'))),
                (owned.subprocess, 'run', lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('unexpected host census'))),
                (admission, '_process_table', lambda: {pid: (row['parent'], 0) for pid, row in self.rows.items()}),
                (admission.lane, 'scheduler', self.scheduler),
                (admission.lane, 'store_reservation', lambda: None),
                (admission.lane, 'alive', lambda pid: pid in self.rows),
            ]:
                stack.enter_context(patch.object(target, name, value))
            yield


def reclaim_controls():
    controls = []
    for mode in ('provider-loss', 'caller-loss', 'checkout-loss', 'premature-release'):
        kernel = Kernel()
        with kernel.installed():
            row = kernel.entry()
            kernel.state = dict(cpuCapacity=2, cpuActive=[row], cpuQueue=[])
            successor = dict(token='next', pid=100, holder=100, owner=50,
                             repo=str(Path.cwd()), slots=2)
            if mode == 'provider-loss':
                del kernel.rows[110]
            elif mode == 'caller-loss':
                del kernel.rows[100]
                # The requester remains independently alive.
                successor.update(pid=50, holder=50, owner=1)
            elif mode == 'checkout-loss':
                row['repo'] = str(Path.cwd() / 'does-not-exist-contract')
            else:
                check(not admission.release_cpu(Path.cwd(), row['token']), 'released live command')
            check(not admission.acquire_cpu(Path.cwd(), successor, 2, 200), 'admitted before drain')
            check(121 in kernel.rows and 120 not in kernel.rows, 'TERM did not isolate surviving work')
            check(owned.group_stopped(120) is False, 'live descendant counted as drained')
            check(admission.release_cpu(Path.cwd(), 'different-token'), 'unrelated release refused')
            check(any(item['token'] == row['token'] for item in kernel.state['cpuActive']), 'lost charged row')
            kernel.now += owned.STOP_GRACE_SECONDS + 1
            check(not admission.acquire_cpu(Path.cwd(), successor, 2, 200), 'freed before kill was observed')
            check((120, signal.SIGKILL) in kernel.signals, 'did not escalate against authenticated group')
            kernel.now += 1
            check(admission.acquire_cpu(Path.cwd(), successor, 2, 200), 'did not admit after actual drain')
            controls.append(mode)
    kernel = Kernel()
    with kernel.installed():
        row = kernel.entry()
        row['ownedCommand']['child']['identity'] = 'forged'
        check(not owned.reclaim(row['ownedCommand'], 110), 'forged identity freed a grant')
        check(not kernel.signals, 'forged identity signalled a group')
        controls.append('forged identity retains capacity without signals')
        refuses(lambda: admission.publish_cpu_child(Path.cwd(), 'absent', kernel.rows[120]))
        controls.append('missing grant publication refuses')
    return controls


def borrowed_controls(limit):
    controls = []
    for loss in ('release', 'provider-loss'):
        kernel = Kernel()
        capacity = min(3, limit)
        slots = min(2, max(1, capacity - 1))
        root = Path.cwd()
        parent = dict(token='parent', pid=50, holder=100, owner=1, repo=str(root), slots=slots)
        budget = dict(slots=slots, capacity=capacity, parentPid=100)
        env = {admission.PARENT_CONTEXT: json.dumps(dict(lease='parent')), 'WS_CPU_ROOT': str(root)}
        with kernel.installed(), patch.object(admission, 'ancestor_cpu_budget', return_value=budget):
            kernel.state = dict(cpuCapacity=capacity, cpuActive=[parent], cpuQueue=[])
            row = kernel.entry(slots=slots)
            admission.register_borrowed_cpu(root, row, env)
            check(row['borrowedFrom'] == 'parent', 'missing ancestor identity')
            check(admission.reserved_slots(kernel.state['cpuActive']) == slots, 'double charged ancestor')
            check(not kernel.state['cpuQueue'], 'borrower entered FIFO')
            controls.append(loss + ': one ancestor budget')
            ordinary = copy.deepcopy(row)
            ordinary['token'] = 'ordinary'
            ordinary['ownedCommand']['child'] = None
            kernel.state['cpuActive'].append(ordinary)
            check(admission.release_cpu(root, 'ordinary'), 'idle borrower did not release')
            check(parent in kernel.state['cpuActive'], 'ordinary release discarded parent')
            controls.append(loss + ': completion preserves parent')
            if loss == 'release':
                kernel.state['cpuActive'].remove(parent)
            else:
                del kernel.rows[50]
            successor = dict(token='next', pid=100, holder=100, owner=1, repo=str(root), slots=capacity)
            check(not admission.acquire_cpu(root, successor, capacity, 200), 'orphan admitted exclusive work')
            check(admission.reserved_slots(kernel.state['cpuActive']) == slots, 'orphan lost its budget')
            check(121 in kernel.rows and kernel.signals == [(120, signal.SIGTERM)], 'missing descendant retention')
            kernel.now += owned.STOP_GRACE_SECONDS + 1
            check(not admission.acquire_cpu(root, successor, capacity, 200), 'freed before drain')
            kernel.now += 1
            check(admission.acquire_cpu(root, successor, capacity, 200), 'exclusive still blocked after drain')
            controls.append(loss + ': orphan remains charged through drain')
    for invalid in ('missing-parent', 'dead-parent', 'wrong-capacity', 'wrong-slots', 'duplicate-token', 'foreign-root'):
        kernel = Kernel()
        root = Path.cwd()
        budget = dict(slots=1, capacity=2, parentPid=100)
        parent = dict(token='parent', pid=50, holder=100, slots=1)
        env = {admission.PARENT_CONTEXT: json.dumps(dict(lease='parent')), 'WS_CPU_ROOT': str(root)}
        with kernel.installed(), patch.object(admission, 'ancestor_cpu_budget', return_value=budget):
            kernel.state = dict(cpuCapacity=2, cpuActive=[parent], cpuQueue=[])
            row = kernel.entry(slots=1)
            if invalid == 'missing-parent': kernel.state['cpuActive'].clear()
            elif invalid == 'dead-parent': del kernel.rows[50]
            elif invalid == 'wrong-capacity': kernel.state['cpuCapacity'] = 3
            elif invalid == 'wrong-slots': row['slots'] = 2
            elif invalid == 'duplicate-token': row['token'] = 'parent'
            else: env['WS_CPU_ROOT'] = str(root / 'foreign')
            refuses(lambda: admission.register_borrowed_cpu(root, row, env))
            check(not kernel.signals and not kernel.state['cpuQueue'], 'refusal changed command admission')
            controls.append(invalid + ' refuses')
    return controls


def build_controls():
    controls = []
    for reply in (b'R', b'', b'X'):
        kernel = Kernel()
        # hold_build_work belongs to its service parent, group 100.
        kernel.rows[121]['group'] = 100
        root = Path.cwd()
        with kernel.installed(), patch.object(admission, 'cpu_root', return_value=root), \
                patch.object(admission, 'ancestor_cpu_budget', return_value=None), \
                patch.object(admission, '_regular_json', return_value={'cpuCapacity': 2}), \
                patch.object(admission.os, 'cpu_count', return_value=4), \
                patch.object(admission.os, 'read', return_value=reply), contextlib.redirect_stdout(io.StringIO()) as output:
            code = admission.hold_build_work(str(root))
            grant = json.loads(output.getvalue())
            check(grant['slots'] == 2 and grant['capacity'] == 2, 'wrong service grant')
            rows = kernel.state['cpuActive']
            if reply == b'R':
                check(code == 0 and not rows and 100 in kernel.rows, 'completion did not release live service')
            else:
                check(code == 130 and len(rows) == 1, 'helper loss freed live work')
                check(rows[0]['pid'] == 100 and rows[0]['ownedCommand']['selfWork'], 'helper owned the service budget')
                check(121 in kernel.rows and 100 not in kernel.rows, 'surviving service descendant lost')
                kernel.now += owned.STOP_GRACE_SECONDS + 1
                check(not admission.release_cpu(root, grant['lease']), 'released before drain acknowledgment')
                kernel.now += 1
                check(admission.release_cpu(root, grant['lease']), 'failed to release drained service')
            controls.append('completed' if reply == b'R' else 'unexpected EOF' if not reply else 'invalid completion')
    return controls


def command_controls():
    kernel = Kernel()
    controls = []
    with kernel.installed():
        actual = owned.capture(110)
        check(owned.ownership()['provider'] == actual, 'provider identity mismatch')
        controls.append('targeted identity')
        for changed in ({'identity': 'forged'}, {'uid': os.getuid() + 1}, {'group': 999}, {'pid': True}):
            check(not owned.same_process({**actual, **changed}), 'accepted forged identity')
        controls.append('forged identity refused')
        child = copy.copy(kernel.rows[120])
        kernel.zombies.add(120)
        check(not owned.same_process(child), 'zombie counted as working')
        kernel.zombies.remove(120)
        del kernel.rows[120]
        check(not owned.same_process(child), 'absent process counted as live')
        kernel.rows[120] = child
        controls.append('stopped identities refused')
        published = []
        events = []
        class Child:
            pid = 120
            returncode = None
            def wait(self, timeout=None):
                self.returncode = 7
                kernel.rows.pop(120, None)
                return 7
        def popen(*_args, **_kwargs):
            events.append('barrier')
            return Child()
        def publish(record):
            events.append('publish')
            published.append(record)
        def write(_fd, value):
            check(events == ['barrier', 'publish'] and value == b'G', 'work escaped publication barrier')
            events.append('execute')
            return 1
        with patch.object(owned.subprocess, 'Popen', side_effect=popen), patch.object(owned.os, 'write', side_effect=write):
            process = owned.start_command(['fixture-command'], {}, (), publish)
            check(events == ['barrier', 'publish', 'execute'] and published == [child], 'publication order mismatch')
            controls.append('barrier before command publication')
            check(process.wait() == 7, 'nonzero command verdict lost')
            controls.append('nonzero verdict retained')
        kernel.rows[120] = child
        with patch.object(owned.subprocess, 'Popen', side_effect=popen), patch.object(owned.os, 'write') as writes:
            def refused(_record):
                raise ValueError('publication refused')
            refuses(lambda: owned.start_command(['fixture-command'], {}, (), refused), ValueError)
            writes.assert_not_called()
            check(120 not in kernel.rows, 'failed publication left running child')
            controls.append('failed publication cannot execute')
        with patch.object(owned.os, 'read', return_value=b''), patch.object(owned.os, 'close'), patch.object(owned.os, 'execvpe') as execute:
            check(owned.child_main(['child', '8', '--', 'fixture']) == 130, 'EOF released the barrier')
            execute.assert_not_called()
            controls.append('provider loss cannot execute')
        with patch.object(owned.os, 'read', return_value=b'G'), patch.object(owned.os, 'close'), patch.object(owned.os, 'execvpe', side_effect=FileNotFoundError):
            refuses(lambda: owned.child_main(['child', '8', '--', 'missing']), FileNotFoundError)
            controls.append('failed exec stays red')
        with patch.object(owned.os, 'read', return_value=b'G'), patch.object(owned.os, 'close'), patch.object(owned.os, 'execvpe') as execute:
            owned.child_main(['child', '8', '--', 'fixture', 'argument'])
            check(execute.call_args.args[:2] == ('fixture', ['fixture', 'argument']), 'command arguments changed')
            controls.append('barrier forwards exact argv')
    return controls


def ancestor_controls():
    controls = []
    for mode in ('valid', 'absent-context', 'foreign-root', 'malformed', 'wrong-version',
                 'boolean-owner', 'missing-grant', 'duplicate-grant', 'wrong-holder',
                 'over-budget', 'dead-provider', 'foreign-owner', 'sibling', 'cycle',
                 'unsafe-ledger', 'census-refusal'):
        kernel = Kernel()
        root = Path.cwd()
        context = dict(version=1, root=str(root), lease='private-capability', ownerPid=100)
        grant = dict(token=context['lease'], holder=100, pid=50, slots=2)
        state = dict(cpuCapacity=3, cpuActive=[grant])
        env = {admission.PARENT_CONTEXT: json.dumps(context), 'WS_CPU_ROOT': str(root)}
        if mode == 'absent-context': env.pop(admission.PARENT_CONTEXT)
        elif mode == 'foreign-root': context['root'] = str(root / 'foreign')
        elif mode == 'wrong-version': context['version'] = True
        elif mode == 'boolean-owner': context['ownerPid'] = True
        elif mode == 'missing-grant': state['cpuActive'].clear()
        elif mode == 'duplicate-grant': state['cpuActive'].append(copy.copy(grant))
        elif mode == 'wrong-holder': grant['holder'] = 110
        elif mode == 'over-budget': grant['slots'] = 4
        elif mode == 'dead-provider': del kernel.rows[50]
        elif mode == 'foreign-owner': kernel.rows[100]['uid'] += 1
        elif mode == 'sibling': kernel.rows[110]['parent'] = 50
        elif mode == 'cycle': kernel.rows[110]['parent'] = 120
        if mode != 'absent-context':
            env[admission.PARENT_CONTEXT] = '{malformed' if mode == 'malformed' else json.dumps(context)
        with kernel.installed(), patch.object(admission, '_regular_json', return_value=state) as ledger, \
                patch.object(admission.subprocess, 'run') as census:
            census.return_value = SimpleNamespace(stdout='\n'.join(
                f"{pid} {row['parent']} {row['uid']}" for pid, row in kernel.rows.items()))
            if mode == 'unsafe-ledger': ledger.side_effect = ValueError('unsafe mode')
            if mode == 'census-refusal': census.side_effect = OSError('unavailable')
            if mode == 'valid':
                check(admission.ancestor_cpu_budget(env) == dict(slots=2, capacity=3, parentPid=100), 'valid ancestor refused')
            elif mode in ('absent-context', 'foreign-root'):
                check(admission.ancestor_cpu_budget(env) is None, 'foreign domain borrowed capacity')
                ledger.assert_not_called()
                census.assert_not_called()
            else:
                try:
                    admission.ancestor_cpu_budget(env)
                except RuntimeError as error:
                    check(str(error) == admission.PARENT_REFUSAL and context['lease'] not in str(error), 'capability echoed')
                else:
                    raise AssertionError('invalid ancestor accepted: ' + mode)
            controls.append(mode)
    return controls


if __name__ == '__main__':
    case = sys.argv[1]
    if case == 'reclaim':
        controls = reclaim_controls()
    elif case == 'borrowed':
        controls = borrowed_controls(int(sys.argv[2]))
    elif case == 'build':
        controls = build_controls()
    elif case == 'command':
        controls = command_controls()
    elif case == 'ancestor':
        controls = ancestor_controls()
    else:
        raise ValueError('unknown contract case')
    print(json.dumps({'controls': controls}))
