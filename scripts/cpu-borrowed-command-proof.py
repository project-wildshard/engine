#!/usr/bin/env python3
"""Real direct/broker ancestor budgets with independently owned nested commands."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid

scripts = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('admission', scripts / 'cpu-admission.py')
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)
owned = admission.owned_command


def until(predicate):
    deadline = time.monotonic() + 10
    while not predicate():
        assert time.monotonic() < deadline, 'borrowed command fixture did not reach its bounded state'
        time.sleep(.02)


if sys.argv[1] == 'borrower':
    root, marker, mode = Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
    entry = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'holder': os.getpid(),
             'owner': os.getppid(), 'repo': str(root), 'slots': 2, 'ownedCommand': owned.ownership()}
    admission.register_borrowed_cpu(root, entry)
    if mode == 'ordinary':
        command = ('import time;from pathlib import Path;p=Path(' + repr(str(marker)) + ');'
                   'p.write_text("ready");\nwhile not p.with_suffix(".finish").exists():time.sleep(.02)')
    else:
        grandchild = 'import time,signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)'
        command = ('import json,os,subprocess,sys,time;from pathlib import Path;'
                   'p=subprocess.Popen([sys.executable,"-c",' + repr(grandchild) + ']);'
                   'time.sleep(.15);Path(' + repr(str(marker)) + ').write_text(json.dumps('
                   '{"root":os.getpid(),"descendant":p.pid}));time.sleep(60)')
    child = owned.start_command([sys.executable, '-c', command], dict(os.environ), (),
                                lambda record: admission.publish_cpu_child(root, entry['token'], record))
    try:
        child.wait()
        until(lambda: owned.group_stopped(child.pid))
    finally:
        owned.terminate_command(child)
        admission.release_cpu(root, entry['token'])
    raise SystemExit(0)

root = Path(sys.argv[1]).resolve() / ('run-' + str(os.getpid()))
root.mkdir(parents=True)
children, sockets, groups, controls = [], [], [], []
try:
    for label in ('direct-release', 'broker-release', 'direct-loss', 'broker-loss'):
        mode, loss = label.split('-')
        work = root / label
        work.mkdir()
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('WS_CPU_', 'WS_HEAVY_'))}
        env.update(WS_CPU_ROOT=str(work), WS_HEAVY_SCHEDULER_ROOT=str(work))
        if mode == 'direct':
            parent = subprocess.Popen([sys.executable, str(scripts / 'cpu-admission.py'),
                                       'hold', '--slots=2', '--capacity=3'],
                                      env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            children.append(parent)
            proof = json.loads(parent.stdout.readline())
            def release_parent():
                parent.stdin.close()
                assert parent.wait(timeout=5) == 0
        else:
            parent = subprocess.Popen([sys.executable, str(scripts / 'cpu-broker.py'),
                                       '--root', str(work), '--capacity=3'],
                                      env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            children.append(parent)
            server = json.loads(parent.stdout.readline())
            client = socket.create_connection(('127.0.0.1', server['port']), timeout=5)
            sockets.append(client)
            client.sendall((json.dumps({'token': server['token'], 'slots': 2, 'repo': str(work),
                                       'pid': os.getpid()}) + '\n').encode())
            with client.makefile('rb') as reader:
                proof = json.loads(reader.readline())
            def release_parent():
                client.shutdown(socket.SHUT_WR)
                until(lambda: not any(row['token'] == proof['lease'] for row in
                                      json.loads((work / 'queue.json').read_text())['cpuActive']))
        context = admission.parent_cpu_context(proof, env)
        env[admission.PARENT_CONTEXT] = context
        marker = work / 'ordinary.ready'
        borrower = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'borrower',
                                     str(work), str(marker), 'ordinary'], env=env)
        children.append(borrower)
        until(marker.exists)
        state = json.loads((work / 'queue.json').read_text())
        assert len(state['cpuActive']) == 2 and admission.reserved_slots(state['cpuActive']) == 2
        assert state['cpuQueue'] == []
        spare = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'holder': os.getpid(),
                 'owner': os.getppid(), 'repo': str(work), 'slots': 1}
        assert admission.acquire_cpu(work, spare, 3, time.monotonic() + 10)
        assert admission.release_cpu(work, spare['token'])
        controls.append(label + ': actual nested command adds no budget or FIFO wait; spare slot remains usable')
        marker.with_suffix('.finish').write_text('finish')
        assert borrower.wait(timeout=5) == 0
        assert [row['token'] for row in json.loads((work / 'queue.json').read_text())['cpuActive']] == [proof['lease']]
        controls.append(label + ': ordinary nested completion releases only its command lifetime')

        marker = work / 'resistant.ready'
        borrower = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'borrower',
                                     str(work), str(marker), 'resistant'], env=env)
        children.append(borrower)
        until(marker.exists)
        command = json.loads(marker.read_text())
        root_record, descendant = owned.capture(command['root']), owned.capture(command['descendant'])
        groups.extend((root_record, descendant))
        if loss == 'release':
            release_parent()
        else:
            parent.kill()
            parent.wait(timeout=5)
        exclusive = {**spare, 'token': uuid.uuid4().hex, 'slots': 3}
        assert not admission.acquire_cpu(work, exclusive, 3, time.monotonic() + 10)
        until(lambda: not owned.same_process(root_record))
        assert owned.same_process(descendant)
        assert not admission.acquire_cpu(work, exclusive, 3, time.monotonic() + 10)
        until(lambda: admission.acquire_cpu(work, exclusive, 3, time.monotonic() + 10))
        assert not owned.same_process(descendant)
        assert borrower.wait(timeout=5) == 0
        assert admission.release_cpu(work, exclusive['token'])
        controls.append(label + ': exclusive work stays blocked through resistant descendant reclaim')
finally:
    for record in groups:
        if owned.same_process(record):
            os.killpg(record['group'], 9)
    for client in sockets:
        client.close()
    for child in children:
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=5)

assert all(owned.group_stopped(record['group']) for record in groups)
print(json.dumps({'controls': controls, 'bothActualProviders': True,
                  'noSecondCpuBudget': True, 'allChildrenDrained': True}))
