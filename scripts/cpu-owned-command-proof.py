#!/usr/bin/env python3
"""Actual process controls for TS22c1a; no CPU reservation policy yet."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(sys.argv[1]).resolve() / ('run-' + str(os.getpid()))
root.mkdir(parents=True)
helper = Path('scripts/cpu-owned-command.py').resolve()
spec = importlib.util.spec_from_file_location('owned_command', helper)
owned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owned)
children, controls = [], []


def until(predicate):
    deadline = time.monotonic() + 5
    while not predicate():
        assert time.monotonic() < deadline, 'owned fixture did not reach its bounded state'
        time.sleep(.01)


try:
    inventory = owned.identity_backend().processes()[0]
    actual = owned.process_record(os.getpid())
    assert actual['identity'] == inventory[os.getpid()].identity
    assert actual['uid'] == inventory[os.getpid()].uid
    assert owned.ownership()['provider'] == actual
    for invalid in (0, -1, True, 2 ** 31):
        try:
            owned.identity_backend().process(invalid)
            raise AssertionError('invalid PID was accepted')
        except ValueError:
            pass
    controls.append('targeted kernel identity agrees with real census inventory')

    marker, finish = root / 'executed.json', root / 'finish'
    program = ("const fs=require('node:fs');fs.writeFileSync(" + json.dumps(str(marker)) +
               ",JSON.stringify({pid:process.pid,parent:process.ppid}));setInterval(()=>{if(fs.existsSync(" +
               json.dumps(str(finish)) + "))process.exit(7);},10)")
    published = []

    def publish(record):
        assert not marker.exists(), 'command ran before publication'
        assert owned.same_process(record)
        assert record['parent'] == os.getpid() and record['group'] == record['pid']
        published.append(record)

    child = owned.start_command([sys.argv[2], '-e', program], dict(os.environ), (), publish)
    children.append(child)
    until(marker.exists)
    assert json.loads(marker.read_text())['pid'] == published[0]['pid'] == child.pid
    assert owned.same_process(published[0])
    finish.write_text('finish')
    assert child.wait(timeout=5) == 7
    assert not owned.same_process(published[0])
    controls.extend(['command waits for successful child identity publication',
                     'kernel identity and private group survive exec', 'actual nonzero verdict is retained'])

    failed_marker, failed_records = root / 'must-not-execute', []
    command = [sys.executable, '-c', 'from pathlib import Path;Path(' + repr(str(failed_marker)) + ").write_text('bad')"]

    def refuse(record):
        failed_records.append(record)
        raise ValueError('fixture publication refused')

    try:
        owned.start_command(command, dict(os.environ), (), refuse)
        raise AssertionError('failed publication launched a command')
    except ValueError as error:
        assert str(error) == 'fixture publication refused'
    assert not failed_marker.exists() and not owned.same_process(failed_records[0])
    controls.append('failed publication reaps its child without executing work')

    provider_file, provider_record = root / 'provider.py', root / 'published.json'
    provider_file.write_text("import importlib.util,json,os\nfrom pathlib import Path\n" +
                            's=importlib.util.spec_from_file_location("owned",' + repr(str(helper)) + ')\n' +
                            'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n' +
                            'def publish(record):\n Path(' + repr(str(provider_record)) +
                            ').write_text(json.dumps(record));os._exit(0)\n' +
                            'm.start_command(' + repr(command) + ',dict(os.environ),(),publish)\n')
    provider = subprocess.Popen([sys.executable, str(provider_file)], start_new_session=True)
    children.append(provider)
    assert provider.wait(timeout=5) == 0
    until(provider_record.exists)
    vanished = json.loads(provider_record.read_text())
    until(lambda: not owned.same_process(vanished))
    assert not failed_marker.exists()
    controls.append('provider exit before barrier release cannot execute the command')

    read_fd, write_fd = os.pipe()
    os.write(write_fd, b'held')
    os.close(write_fd)
    try:
        fd_marker = root / 'descriptor-kept'
        program = ('import os;from pathlib import Path;assert os.read(' + str(read_fd) +
                   ",4)==b'held';Path(" + repr(str(fd_marker)) + ").write_text('yes')")
        child = owned.start_command([sys.executable, '-c', program], dict(os.environ), (read_fd,), lambda _: None)
        children.append(child)
        assert child.wait(timeout=5) == 0 and fd_marker.read_text() == 'yes'
    finally:
        os.close(read_fd)
    controls.append('actual inherited lease descriptors survive barrier and exec')

    child = owned.start_command([str(root / 'missing-command')], dict(os.environ), (), lambda _: None)
    children.append(child)
    assert child.wait(timeout=5) != 0
    controls.append('failed command exec remains a failure and drains')

    unrelated = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(20)'], start_new_session=True)
    children.append(unrelated)
    current = owned.capture(unrelated.pid)
    assert owned.same_process(current)
    for patch in ({'identity': 'stale'}, {'uid': os.getuid() + 1}, {'group': current['group'] + 1},
                  {'pid': True}, {'identity': 'x' * 257}):
        assert not owned.same_process({**current, **patch})
    assert not owned.same_process({**published[0], 'pid': unrelated.pid})
    os.kill(unrelated.pid, 0)
    controls.append('forged and reused identity does not match or signal unrelated live work')

finally:
    for child in children:
        if child.poll() is None:
            owned.terminate_command(child)

assert all(child.poll() is not None for child in children)
print(json.dumps({'state': 'TS22c1a real process publication qualification',
                  'controls': controls, 'allChildrenDrained': True}))
