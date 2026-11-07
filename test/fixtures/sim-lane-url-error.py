"""Immediate service-error ports for one Bash handover fixture, not a simulator.

The real helper entry, bootstatus prerequisite and Bash lease/cleanup still run.
Only wait_for_safari's native clients/page use a controlled readiness clock, so
OS scheduling cannot turn this immediate-error case into the separate hang case.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import sys
import time as wall_time
from types import FunctionType, SimpleNamespace


def controlled_wait(native, udid, process_delay):
    clock = SimpleNamespace(now=0)
    clock.monotonic = lambda: clock.now
    root = Path(os.environ['SIM_FIXTURE'])

    class Ready:
        def is_set(self): return False
        def wait(self, seconds): clock.now += seconds; return False

    class Launch:
        returncode = None
        def __init__(self, output): self.output = output
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def poll(self):
            if self.returncode is None and clock.now >= .004:
                self.output.write(b'com.apple.mobilesafari: 123\n')
                self.output.flush()
                (root / 'safari-launched').touch()
                self.returncode = 0
            return self.returncode
        def kill(self): self.returncode = -9
        def wait(self): return self.returncode

    class Client:
        returncode = 60
        def __enter__(self):
            # Model descheduling independently of the service's immediate result.
            wall_time.sleep(process_delay)
            clock.now += .004
            return self
        def __exit__(self, *_args): pass
        def poll(self): return self.returncode

    def process(args, **kwargs):
        with (root / 'calls').open('a') as output:
            output.write(json.dumps(args[1:]) + '\n')
        if args == ['xcrun', 'simctl', 'launch', udid, 'com.apple.mobilesafari']:
            return Launch(kwargs['stdout'])
        if args[:4] != ['xcrun', 'simctl', 'openurl', udid]:
            raise AssertionError(f'Unexpected immediate-error native command: {args}')
        if not args[4].startswith('http://127.0.0.1/'):
            raise AssertionError('Foreign owned fixture URL')
        attempts = root / 'attempts'
        attempts.write_text(str(int(attempts.read_text()) + 1 if attempts.exists() else 1))
        kwargs['stderr'].write(b'URL service unavailable (60)\n')
        kwargs['stderr'].flush()
        return Client()

    @contextmanager
    def page(*_args): yield 'http://127.0.0.1/owned-service-error', Ready()

    screenshot = SimpleNamespace(records=[], preparation={}, poll=lambda: None,
                                 start=lambda *_args: None, finish=lambda: None)
    ports = {**native.__globals__, 'time': clock, 'readiness_page': page,
             'threading': SimpleNamespace(Event=Ready), 'PREPARED_SCREENSHOTS': None,
             'SafariScreenshots': lambda *_args: screenshot,
             'subprocess': SimpleNamespace(Popen=process, DEVNULL=subprocess.DEVNULL)}
    opening = ports['open_ready_page']
    ports['open_ready_page'] = FunctionType(opening.__code__, ports, argdefs=opening.__defaults__)
    result = FunctionType(native.__code__, ports)(udid)
    if clock.now != float(os.environ['SIM_SAFARI_READY_TIMEOUT']):
        raise AssertionError('Original readiness clock was not exhausted')
    if (root / 'attempts').read_text() != '2':
        raise AssertionError('Original prerequisite-edge reoffer changed')
    return result


def run(helper, argv, process_delay=0):
    source = Path(helper).read_text()
    marker = "\nif __name__ == '__main__':"
    if source.count(marker) != 1:
        raise AssertionError('Original helper entry boundary changed')
    # Leave every production function and the entry/bootstatus code unchanged.
    adapter = ("\n_fixture_original_wait = wait_for_safari\n"
               "def wait_for_safari(udid):\n"
               "    return _fixture_wait(_fixture_original_wait, udid, _fixture_delay)\n")
    sys.argv = argv
    namespace = {'__name__': '__main__', '__file__': str(helper),
                 '_fixture_wait': controlled_wait, '_fixture_delay': process_delay}
    exec(compile(source.replace(marker, adapter + marker), str(helper), 'exec'), namespace)
