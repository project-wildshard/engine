"""Wait for a native Safari document's frame callbacks within one wall deadline."""
import sys
import time

IMPORT_STARTED = time.monotonic()

from contextlib import contextmanager
import math
import json
import os
from pathlib import Path
import secrets
import select
from socketserver import StreamRequestHandler, ThreadingTCPServer
import subprocess
import tempfile
import threading


def selected_simctl():
    # The runner already pins this Xcode. Avoid PATH and xcrun tool resolution
    # without another discovery RPC; unavailable installations keep the old CLI.
    developer = os.environ.get('DEVELOPER_DIR', '')
    if os.path.isabs(developer):
        executable = Path(developer) / 'usr/bin/simctl'
        try:
            if executable.is_file() and os.access(executable, os.X_OK):
                return (str(executable),)
        except OSError:
            pass
    return ('xcrun', 'simctl')


# One selection, charged to the existing import/admission interval.
SIMCTL_COMMAND = selected_simctl()
PREPARED_SCREENSHOTS = None
# Internal deadline refusal is not an observed native exit 124.
LAUNCH_DEADLINE = object()


@contextmanager
def native_transcript():
    # A native service may inherit simctl's output handle. Pipe EOF then
    # waits for that service, not for the bounded client command to exit.
    scratch = Path(__file__).resolve().parent.parent / 'tmp'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryFile(dir=scratch) as stream:
        yield stream


def native_text(stream):
    # Snapshot current output without EOF or changing an inherited offset.
    return os.pread(stream.fileno(), os.fstat(stream.fileno()).st_size, 0).decode(errors='replace')


@contextmanager
def bootstatus_transcript():
    # Verbose native migration output must not wait for the Actions console
    # (Node -> tee -> runner) to drain. Retain both descriptors in the existing
    # preparation artifact; only the native exit can satisfy the prerequisite.
    preparation = os.environ.get('PHONE_SIMULATOR_PREPARATION')
    if preparation:
        path = Path(preparation).with_suffix('.bootstatus.log')
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f'sim-lane: native bootstatus transcript {path}', file=sys.stderr, flush=True)
        with path.open('w+b') as stream:
            yield stream
    else:
        with native_transcript() as stream:
            try:
                yield stream
            finally:
                # Interactive callers keep a bounded diagnostic tail. Never
                # copy an unbounded native transcript back into the pipe.
                size = os.fstat(stream.fileno()).st_size
                tail = os.pread(stream.fileno(), min(size, 2048), max(0, size - 2048))
                if tail:
                    print(tail.decode(errors='replace'), file=sys.stderr, flush=True)


def owned_launch_pid(text):
    """A complete PID receipt from our exact UDID-bound launch command.

    This permits asking for the owned probe URL, never granting readiness.
    Read only that command's output; no process inventory is spawned.
    """
    for line in text.splitlines(keepends=True):
        if not line.endswith('\n'):
            continue
        app, separator, value = line.rstrip('\r\n').partition(':')
        value = value.strip()
        if (separator and app == 'com.apple.mobilesafari'
                and value.isascii() and value.isdigit() and int(value) > 0):
            return int(value)
    return None


def screenshot_status(fd, event, **fields):
    """One bounded nonblocking control message; never a proof or file sink."""
    try:
        message = (json.dumps({'event': event, **fields}) + '\n').encode()
        return len(message) <= 2048 and os.write(fd, message) == len(message)
    except OSError:
        return False


def screenshot_close_fds(keep):
    # A diagnostic worker must not inherit the Simulator lease or another
    # diagnostic slot's writer. All descriptor setup happens during admission.
    start = 3
    for fd in sorted(set(keep)):
        if fd >= start:
            os.closerange(start, fd)
            start = fd + 1
    os.closerange(start, os.sysconf('SC_OPEN_MAX'))


def safari_screenshot_child(udid, directory, deadline):
    """Replace an already-prepared worker, without creating a process."""
    if time.monotonic() >= deadline:
        return 124
    command = [*SIMCTL_COMMAND, 'io', udid, 'screenshot', str(directory / 'screen.png')]
    if os.path.isabs(command[0]):
        return os.execv(command[0], command)
    return os.execvp(command[0], command)


def safari_screenshot_supervisor(udid, directory, request, status, errors, null, admission_deadline):
    commands, offer = os.pipe()
    os.set_blocking(offer, False)
    worker = os.fork()
    if worker == 0:
        try:
            os.close(offer)
            os.dup2(null, 0); os.dup2(null, 1); os.dup2(errors, 2)
            screenshot_close_fds([commands, status])
            screenshot_status(status, 'worker-ready', worker=os.getpid())
            message = os.read(commands, 2048)
            if not message:
                os._exit(0)
            deadline = json.loads(message)['deadline']
            if not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
                os._exit(64)
            if time.monotonic() >= deadline:
                screenshot_status(status, 'no-budget')
                os._exit(124)
            screenshot_status(status, 'exec-requested', at=time.monotonic())
            result = safari_screenshot_child(udid, directory, deadline)
            screenshot_status(status, 'no-budget' if result == 124 else 'exec-error', errorType='ExecReturned')
            os._exit(result if isinstance(result, int) and 0 <= result <= 255 else 127)
        except BaseException as error:
            screenshot_status(status, 'exec-error', errorType=type(error).__name__)
            os._exit(127)
    os.close(commands)
    os.dup2(null, 0); os.dup2(null, 1); os.dup2(null, 2)
    screenshot_close_fds([request, status, offer])
    screenshot_status(status, 'supervisor-ready')
    # A parent exit closes the sole request writer. The idle ceiling is only
    # leak cleanup; it cannot grant admission or a Safari frame.
    idle_end = admission_deadline + 601
    while True:
        remaining = idle_end - time.monotonic()
        if remaining <= 0:
            os.killpg(os.getpid(), 9)
        if select.select([request], [], [], min(.05, remaining))[0]:
            message = os.read(request, 2048)
            if not message:
                os.killpg(os.getpid(), 9)
            job = json.loads(message)
            deadline = job['deadline']
            if not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
                os.killpg(os.getpid(), 9)
            # Only one command reaches this pre-created worker, even if its
            # parent was descheduled past the original one-second bound.
            if time.monotonic() < deadline:
                os.write(offer, message)
            else:
                screenshot_status(status, 'no-budget')
                os.killpg(os.getpid(), 9)
            break
    while True:
        done, result = os.waitpid(worker, os.WNOHANG)
        remaining = deadline - time.monotonic()
        if done:
            screenshot_status(status, 'client-exit', clientReturnCode=os.waitstatus_to_exitcode(result), late=remaining <= 0)
        elif remaining <= 0:
            screenshot_status(status, 'expired')
        if done or remaining <= 0:
            os.killpg(os.getpid(), 9)
        time.sleep(min(.01, remaining))


class SafariScreenshots:
    """Prepare both groups during admission; active proof only writes pipes."""
    phases = ('after-second-url', 'readiness-timeout')

    def __init__(self, udid, started):
        self.udid, self.started = udid, started
        self.receipt = os.environ.get('PHONE_SIMULATOR_PREPARATION', '')
        self.records, self.active, self.seen, self.slots = [], {}, set(), {}
        self.finish_deadline = None
        self.preparation = {'startedAt': None, 'completedAt': None, 'ready': 0, 'errors': []}

    def prepare(self, deadline):
        if not self.receipt or not Path(self.receipt).is_absolute():
            return
        self.preparation['startedAt'] = round(time.monotonic() - IMPORT_STARTED, 3)
        for phase in self.phases:
            if time.monotonic() >= deadline:
                break
            descriptors = []
            try:
                directory = Path(tempfile.mkdtemp(prefix=f'{Path(self.receipt).stem}-safari-{phase}-', dir=Path(self.receipt).parent))
                errors = os.open(directory / 'native.err', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                descriptors.append(errors)
                null = os.open(os.devnull, os.O_RDWR); descriptors.append(null)
                request, send = os.pipe(); descriptors.extend((request, send))
                receive, status = os.pipe(); descriptors.extend((receive, status))
                for fd in (send, receive, status): os.set_blocking(fd, False)
                pid = os.fork()
                if pid == 0:
                    try:
                        os.setpgid(0, 0)
                        safari_screenshot_supervisor(self.udid, directory, request, status, errors, null, deadline)
                    except BaseException:
                        try: os.killpg(os.getpid(), 9)
                        except OSError: pass
                    os._exit(1)
                try: os.setpgid(pid, pid)
                except OSError: pass
                slot = {'pid': pid, 'send': send, 'receive': receive, 'buffer': b'', 'ready': set(),
                        'directory': directory, 'record': None, 'deadline': None, 'forkedAt': time.monotonic()}
                self.slots[phase] = slot; self.active[pid] = slot
                descriptors.remove(send); descriptors.remove(receive)
            except (OSError, ValueError) as error:
                self.preparation['errors'].append(type(error).__name__)
            finally:
                for fd in descriptors: os.close(fd)
        while self.active and time.monotonic() < deadline:
            self.reap()
            if all(len(slot['ready']) == 2 for slot in self.active.values()): break
            threading.Event().wait(min(.01, max(0, deadline - time.monotonic())))
        self.preparation.update(completedAt=round(time.monotonic() - IMPORT_STARTED, 3),
                                ready=sum(len(slot['ready']) == 2 for slot in self.active.values()))

    def start(self, phase, deadline=None):
        if phase in self.seen or phase not in self.phases:
            return
        self.seen.add(phase)
        requested = time.monotonic()
        end = min(requested + 1, deadline) if deadline is not None else requested + 1
        record = {'phase': phase, 'requestedAt': round(requested - self.started, 3),
                  'deadlineAt': round(end - self.started, 3), 'dispatchFinishedAt': None,
                  'forkedAt': None, 'killAt': None, 'reapedAt': None, 'supervisorExit': None,
                  'path': None, 'stderr': None, 'nativeReturnCode': None, 'status': 'not-prepared'}
        self.records.append(record)
        if requested >= end:
            record['status'] = 'no-budget'
            return
        slot = self.slots.get(phase)
        if slot is None or slot['pid'] not in self.active or len(slot['ready']) != 2:
            return
        record.update(path=str(slot['directory'] / 'screen.png'), stderr=str(slot['directory'] / 'native.err'),
                      forkedAt=round(slot['forkedAt'] - self.started, 3), precreated=True)
        slot['record'], slot['deadline'] = record, end
        if requested >= end:
            record['status'] = 'no-budget'
            return
        try:
            message = (json.dumps({'deadline': end}) + '\n').encode()
            if os.write(slot['send'], message) != len(message):
                raise OSError('Incomplete screenshot command')
            record.update(status='running', dispatchFinishedAt=round(time.monotonic() - self.started, 3))
        except OSError as error:
            record.update(status='dispatch-error', errorType=type(error).__name__)

    def reap(self):
        self.poll(reap_only=True)

    def kill_owned(self, pid, slot, fallback=False):
        # Diagnostic cleanup cannot replace the owned native result. Keep a
        # refused signal pending and never retry it or broaden its target.
        if slot.get('cleanupRefused'):
            return
        try:
            try: os.killpg(pid, 9)
            except ProcessLookupError:
                if fallback: os.kill(pid, 9)
        except OSError as error:
            slot['cleanupRefused'] = True
            record = slot['record']
            if record is not None:
                record.update(status='cleanup-refused', cleanupPending=True,
                              cleanupRefusedAt=round(time.monotonic() - self.started, 3),
                              cleanupErrorType=type(error).__name__, cleanupErrno=error.errno)
            else:
                self.preparation['errors'].append(f'cleanup:{type(error).__name__}:{error.errno}')

    def messages(self, slot):
        record = slot['record']
        try: chunk = os.read(slot['receive'], 4096)
        except BlockingIOError: chunk = b''
        slot['buffer'] += chunk
        while b'\n' in slot['buffer']:
            line, slot['buffer'] = slot['buffer'].split(b'\n', 1)
            event = json.loads(line)
            kind = event['event']
            if kind in ('worker-ready', 'supervisor-ready'): slot['ready'].add(kind)
            elif record is not None:
                if kind == 'exec-requested': record['execRequestedAt'] = round(event['at'] - self.started, 3)
                elif kind == 'exec-error': record.update(status='exec-error', errorType=event['errorType'])
                elif kind == 'client-exit':
                    record['clientReturnCode'] = event['clientReturnCode']
                    if record['status'] not in ('exec-error', 'no-budget'):
                        code = event['clientReturnCode']
                        record.update(status='late' if code == 0 and event['late'] else 'client-exit',
                                      nativeReturnCode=code, result=124 if code == 0 and event['late'] else code)
                elif kind in ('expired', 'no-budget'): record['status'] = kind

    def poll(self, reap_only=False):
        for pid, slot in list(self.active.items()):
            record = slot['record']
            try:
                self.messages(slot)
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    self.messages(slot)
                    if record is not None:
                        record.update(reapedAt=round(time.monotonic() - self.started, 3), supervisorExit=os.waitstatus_to_exitcode(status))
                        if record['status'] == 'running': record['status'] = 'stopped'
                    os.close(slot['receive'])
                    if slot['send'] is not None: os.close(slot['send']); slot['send'] = None
                    del self.active[pid]
                elif not reap_only and record is not None and time.monotonic() >= slot['deadline'] and record['killAt'] is None:
                    record.update(status='timeout', killAt=round(time.monotonic() - self.started, 3))
                    self.kill_owned(pid, slot, fallback=True)
            except (OSError, ValueError) as error:
                if record is not None: record.update(status='cleanup-error', errorType=type(error).__name__)

    def finish(self):
        for slot in self.active.values():
            if slot['record'] is None and slot['send'] is not None:
                os.close(slot['send']); slot['send'] = None
        if self.finish_deadline is None: self.finish_deadline = time.monotonic() + 1
        end = self.finish_deadline
        while self.active:
            self.poll()
            remaining = end - time.monotonic()
            if remaining <= 0:
                for pid, slot in self.active.items():
                    self.kill_owned(pid, slot)
                self.reap()
                break
            threading.Event().wait(min(.01, remaining))


@contextmanager
def readiness_page(deadline, started=None, lifecycle=None):
    # Port 9 is a Fetch bad port, not a usable Safari warm-up document.
    # An unpredictable local page proves two real frames, without app assets,
    # external networking, an error page or a LaunchServices exit-code guess.
    token = secrets.token_hex(12)
    page, callback, transport = f'/safari/{token}', f'/ready/{token}', f'/transport/{token}'
    ready = threading.Event()
    requested = threading.Event()
    started = time.monotonic() if started is None else started
    # Transport milestones are diagnostic; only the owned callback grants frames.
    phases = {name: {'count': 0, 'firstSeconds': None, 'lastSeconds': None}
              for name in ('accept', 'request', 'flush', 'callbackRequest', 'callbackFlush',
                           'transportRequest', 'transportFlush')}
    if lifecycle is not None:
        lifecycle['http'] = phases
    phase_lock = threading.Lock()
    listener = {'boundAddress': None, 'startedAt': None, 'cycles': 0,
                'firstCycleAt': None, 'lastCycleAt': None, 'stoppedAt': None,
                'aliveBeforeShutdown': None, 'errorType': None}

    def record_http(name):
        with phase_lock:
            when = round(time.monotonic() - started, 3)
            phase = phases[name]
            phase['count'] += 1
            if phase['firstSeconds'] is None:
                phase['firstSeconds'] = when
            phase['lastSeconds'] = when

    document = ('<!doctype html><meta name="viewport" content="width=device-width">'
                '<script>requestAnimationFrame(()=>requestAnimationFrame(()=>'
                f'fetch("{callback}",{{cache:"no-store"}})));</script>').encode()

    class Handler(StreamRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(1)

        def reply(self, code, body, probe=False):
            reason = {200: 'OK', 400: 'Bad Request', 404: 'Not Found',
                      431: 'Request Header Fields Too Large', 501: 'Not Implemented'}[code]
            headers = [f'HTTP/1.0 {code} {reason}', 'Content-Type: text/html; charset=utf-8',
                       f'Content-Length: {len(body)}', 'Cache-Control: no-store', 'Connection: close']
            if probe:
                headers.append(f'X-Safari-Ready: {callback}')
            self.wfile.write(('\r\n'.join(headers) + '\r\n\r\n').encode() + body)
            self.wfile.flush()

        def handle(self):
            # Only the owned loopback GET probe is served. Bound parsing under
            # the same one-second connection limit; no HTTP/email/MIME stack.
            line = self.rfile.readline(8193)
            parts = line.split()
            if len(line) > 8192 or len(parts) != 3 or parts[2] not in (b'HTTP/1.0', b'HTTP/1.1'):
                self.reply(400, b'Bad request')
                return
            size = len(line)
            for _ in range(100):
                header = self.rfile.readline(8193)
                size += len(header)
                if not header or len(header) > 8192 or size > 16384:
                    self.reply(431, b'Invalid headers')
                    return
                if header in (b'\r\n', b'\n'):
                    break
            else:
                self.reply(431, b'Too many headers')
                return
            if parts[0] != b'GET':
                self.reply(501, b'GET only')
                return
            path = parts[1]
            if path == transport.encode():
                # This native diagnostic is never a document or frame callback.
                # Aggregate TCP accepts include it; Safari request/callback
                # counters remain separate from the transport-only counters.
                record_http('transportRequest')
                self.reply(200, f'transport:{token}'.encode())
                record_http('transportFlush')
                return
            if path not in (page.encode(), callback.encode()):
                self.reply(404, b'Not found')
                return
            probe = path == page.encode()
            record_http('request' if probe else 'callbackRequest')
            first_probe = probe and not requested.is_set()
            if first_probe:
                requested.set()
            self.reply(200, document if probe else b'ready', probe)
            record_http('flush' if probe else 'callbackFlush')
            if first_probe:
                print(f'sim-lane: Safari readiness document requested in {time.monotonic() - started:.3f}s', file=sys.stderr)
            if not probe and time.monotonic() <= deadline:
                ready.set()
                print(f'sim-lane: Safari owned frame callback received in {time.monotonic() - started:.3f}s', file=sys.stderr)

    class ReadinessServer(ThreadingTCPServer):
        def service_actions(self):
            # Observe the existing selector cycle, without adding a poll, a
            # connection, or a readiness condition of our own.
            super().service_actions()
            with phase_lock:
                when = round(time.monotonic() - started, 3)
                listener['cycles'] += 1
                if listener['firstCycleAt'] is None:
                    listener['firstCycleAt'] = when
                listener['lastCycleAt'] = when

        def get_request(self):
            connection = super().get_request()
            record_http('accept')
            return connection

        def handle_error(self, request, client_address):
            # socketserver's default logger imports traceback after printing
            # its heading. Keep the actual exception/phase in one flushed
            # record, without importing or reading source on this cold path.
            _, error, trace = sys.exc_info()
            frames = []
            for _ in range(8):
                if trace is None:
                    break
                code = trace.tb_frame.f_code
                frames.append({'file': code.co_filename, 'function': code.co_name, 'line': trace.tb_lineno})
                trace = trace.tb_next
            evidence = {'elapsedSeconds': time.monotonic() - started,
                        'documentRequested': requested.is_set(), 'ownedFrames': ready.is_set(),
                        'errorType': type(error).__name__, 'message': str(error)[:512], 'frames': frames}
            print('sim-lane: Safari readiness handler error ' + json.dumps(evidence), file=sys.stderr, flush=True)

    # TCPServer binds the fixed loopback address without reverse-DNS work.
    with ReadinessServer(('127.0.0.1', 0), Handler) as server:
        server.daemon_threads = True
        listener['boundAddress'] = {'host': server.server_address[0], 'port': server.server_address[1]}

        def serve():
            listener['startedAt'] = round(time.monotonic() - started, 3)
            try:
                server.serve_forever(poll_interval=.02)
            except BaseException as error:
                listener['errorType'] = type(error).__name__
                raise
            finally:
                listener['stoppedAt'] = round(time.monotonic() - started, 3)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_address[1]}{page}', ready
        finally:
            listener['aliveBeforeShutdown'] = thread.is_alive()
            server.shutdown()
            thread.join()
            if lifecycle is not None:
                with phase_lock:
                    lifecycle['http'] = {name: dict(phase) for name, phase in phases.items()}
                    lifecycle['listener'] = dict(listener)


def native_transport_witness(udid, url, deadline, started):
    """Diagnostic only: one simctl-spawned TCP client, never Safari or frames."""
    record = {'status': 'unavailable', 'requestedAt': round(time.monotonic() - started, 3),
              'completedAt': None, 'nativeReturnCode': None}
    try:
        preparation = os.environ.get('PHONE_SIMULATOR_PREPARATION', '')
        prefix = 'http://127.0.0.1:'
        port, separator, token = url.removeprefix(prefix).partition('/safari/')
        if (not os.path.isabs(preparation) or not url.startswith(prefix)
                or not port.isdecimal() or not 1024 < int(port) <= 65535 or not separator
                or len(token) != 24 or any(char not in '0123456789abcdef' for char in token)):
            return record
        binary = Path(preparation).with_suffix('.transport')
        log = Path(preparation).with_suffix('.transport.log')
        record.update(destination=f'{prefix}{port}/transport/{token}', log=str(log), binary=str(binary))
        if not binary.is_file() or not os.access(binary, os.X_OK):
            record['status'] = 'missing-client'
            return record
        command = [*SIMCTL_COMMAND, 'spawn', udid, str(binary), port, token]
        # The phone job builds this client before the Safari wall starts. Only
        # its one RPC spends the original URL-sized slice; no deadline restarts.
        diagnostic_deadline = min(deadline, time.monotonic() + 10)
        with log.open('wb') as output:
            remaining = diagnostic_deadline - time.monotonic()
            if remaining <= 0:
                record['status'] = 'expired'
                return record
            record['command'] = command
            result = subprocess.run(command, stdout=output, stderr=output, timeout=remaining, check=False)
            record['nativeReturnCode'] = result.returncode
        record['status'] = 'native-exit' if time.monotonic() < diagnostic_deadline else 'expired'
    except subprocess.TimeoutExpired:
        record['status'] = 'expired'
    except OSError as error:
        record.update(status='unavailable', errorType=type(error).__name__)
    finally:
        record['completedAt'] = round(time.monotonic() - started, 3)
    return record


def open_ready_page(udid, url, ready, deadline, timeout, started, launch_state=None, lifecycle=None, screenshots=None, http=None):
    code, detail = 124, 'URL service did not respond'
    if lifecycle is not None:
        lifecycle['destination'] = url
    attempts, accepted, pending_delivery, pending_before_launch = 0, False, False, False
    transport_offered = False
    ownership = launch_state if launch_state is not None else lambda: 0

    def failed_launch(status):
        # Keep a settled URL error when only the app proof's clock expires.
        # Actual native launch errors, including native 124, still take priority.
        return (124 if code == 0 else code) if status is LAUNCH_DEADLINE else status

    def stamp(record, phase):
        if record is not None:
            record[phase] = round(time.monotonic() - started, 3)

    while True:
        if screenshots is not None:
            screenshots.poll()
        launch_code = ownership()
        if launch_code is not None and launch_code != 0:
            return failed_launch(launch_code)
        if ready.is_set() and launch_code == 0:
            print(f'sim-lane: Safari readiness page reached two animation frames in {time.monotonic() - started:.3f}s; '
                  'owned launch and owned two-frame callback confirmed', file=sys.stderr)
            return 0
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            print(f'sim-lane: Safari URL readiness timed out after {timeout:g}s: {detail}', file=sys.stderr)
            return 124 if code == 0 else code
        if pending_delivery and pending_before_launch and launch_code == 0:
            # The app prerequisite changed after a request made during launch.
            # Permit its first launched-state delivery, never a timed replay
            # while that prerequisite remains unchanged.
            pending_delivery = False
            print('sim-lane: owned app launch confirmed; delivering its probe once in the launched state', file=sys.stderr)
        if ready.is_set() or accepted or pending_delivery:
            if (pending_delivery and not pending_before_launch and launch_code == 0 and not ready.is_set()
                    and not transport_offered and os.environ.get('GITHUB_ACTIONS') == 'true'
                    and (http is None or http['request']['count'] == 0)
                    and os.environ.get('PHONE_SIMULATOR_PREPARATION')):
                transport_offered = True
                transport = native_transport_witness(udid, url, deadline, started)
                if lifecycle is not None:
                    lifecycle['transport'] = transport
                continue  # Recheck only the existing launch/frame/deadline predicates.
            # A completed delivery or a stopped unresponsive client can leave
            # this exact URL queued in native services. Await its owned page
            # instead of issuing duplicates under the same launch state.
            threading.Event().wait(min(.05, remaining))
            continue
        attempts += 1
        launch_pending = launch_code is None
        attempt_started = time.monotonic()
        attempt_deadline = min(deadline, attempt_started + 10)
        record = None
        if lifecycle is not None:
            record = {'attempt': attempts, 'offeredAt': round(attempt_started - started, 3),
                      'deadlineAt': round(attempt_deadline - started, 3),
                      **{phase: None for phase in ('spawnRequestedAt', 'spawnedAt', 'killAt',
                         'reapRequestedAt', 'reapedAt', 'settledAt', 'exitedAt')},
                      'nativeReturnCode': None, 'result': None}
            lifecycle['count'] += 1
            if len(lifecycle['samples']) == 4:
                lifecycle['samples'].pop(0)
                lifecycle['omitted'] += 1
            lifecycle['samples'].append(record)
        print(f'sim-lane: Safari openurl attempt {attempts} started at {attempt_started - started:.3f}s', file=sys.stderr)
        stamp(record, 'spawnRequestedAt')
        with native_transcript() as errors, subprocess.Popen([*SIMCTL_COMMAND, 'openurl', udid, url],
                              stdout=subprocess.DEVNULL, stderr=errors, text=True) as child:
            stamp(record, 'spawnedAt')
            if attempts == 2 and screenshots is not None:
                # Observe the launched-state offer only after its client starts.
                # This image spends the same URL/global remainder, never a new
                # ten-second window or another URL offer.
                screenshots.start('after-second-url', attempt_deadline)
            while child.poll() is None and not ready.is_set() and time.monotonic() < attempt_deadline:
                if screenshots is not None:
                    screenshots.poll()
                launch_code = ownership()
                if launch_code is not None and launch_code != 0:
                    break
                ready.wait(min(.05, max(0, attempt_deadline - time.monotonic())))
            if child.poll() is None:
                stamp(record, 'killAt')
                child.kill()
                stamp(record, 'reapRequestedAt')
                child.wait()
                stamp(record, 'reapedAt')
                code = 124
                pending_delivery, pending_before_launch = not ready.is_set(), launch_pending
                detail = 'openurl client stopped after frame proof' if ready.is_set() else 'openurl did not respond before its deadline; awaiting the same owned page'
                partial_error = native_text(errors).strip()
                if partial_error:
                    detail += f'; native stderr: {partial_error[-2048:]}'
            else:
                stamp(record, 'reapedAt')
                error = native_text(errors)
                code = child.returncode if child.returncode >= 0 else 128 - child.returncode
                detail = error.strip() or f'openurl exited {code}'
                if code == 0 and not ready.is_set():
                    accepted = True
                    print(f'sim-lane: Safari URL accepted in {time.monotonic() - started:.3f}s; awaiting owned frame callback', file=sys.stderr)
                    detail = 'URL accepted; owned two-frame callback pending'
            if record is not None:
                record['nativeReturnCode'], record['result'] = child.returncode, code
            stamp(record, 'settledAt')
            print(f'sim-lane: Safari openurl attempt {attempts} settled in {time.monotonic() - attempt_started:.3f}s; '
                  f'client exit {code}; ownedFrames={ready.is_set()}; {detail[-2048:]}', file=sys.stderr)
        stamp(record, 'exitedAt')
        if launch_code is not None and launch_code != 0:
            return failed_launch(launch_code)
        if not ready.is_set() and not accepted and not pending_delivery:
            current_launch = ownership()
            if current_launch is not None and current_launch != 0:
                return failed_launch(current_launch)
            if launch_pending and current_launch == 0:
                # The failed request raced app initialization. Its prerequisite
                # has now changed; no arbitrary backoff is needed for that edge.
                # Later failures retain the existing one-second service delay.
                continue
            ready.wait(min(1, max(0, deadline - time.monotonic())))


def wait_for_safari(udid):
    try:
        timeout = float(os.environ.get('SIM_SAFARI_READY_TIMEOUT', '120'))
    except ValueError:
        timeout = 0
    if not math.isfinite(timeout) or not 0 < timeout <= 600:
        print('sim-lane: SIM_SAFARI_READY_TIMEOUT must be in (0, 600] seconds', file=sys.stderr)
        return 64
    deadline = time.monotonic() + timeout
    # Start the app once and deliver its one owned probe concurrently. A slow
    # launch reply must not postpone the document until the final few seconds.
    # Neither proof alone grants a lease; both keep the same wall deadline.
    started = time.monotonic()
    evidence = {'source': 'owned-launch-output', 'checks': 0, 'totalMs': 0.0, 'maxMs': 0.0}
    next_receipt_check, admitted = started, False
    def report_receipt_evidence():
        print(f'sim-lane: Safari launch receipt evidence {json.dumps(evidence)}', file=sys.stderr)
    lifecycle = {'simctlCommand': list(SIMCTL_COMMAND), 'launch': {phase: None for phase in ('spawnRequestedAt', 'spawnedAt',
                 'ownedAt', 'completedAt', 'killAt', 'reapRequestedAt', 'reapedAt')},
                 'url': {'count': 0, 'omitted': 0, 'samples': []}, 'http': None, 'screenshots': []}
    lifecycle['launch']['nativeReturnCode'] = None
    result, ready = None, None
    screenshots = PREPARED_SCREENSHOTS or SafariScreenshots(udid, started)
    screenshots.started = started
    lifecycle['screenshotPreparation'] = screenshots.preparation
    lifecycle['screenshots'] = screenshots.records

    def stamp_launch(phase):
        lifecycle['launch'][phase] = round(time.monotonic() - started, 3)

    try:
        with native_transcript() as output, native_transcript() as errors, readiness_page(deadline, started, lifecycle) as (url, ready):
            stamp_launch('spawnRequestedAt')
            with subprocess.Popen([*SIMCTL_COMMAND, 'launch', udid, 'com.apple.mobilesafari'],
                                  stdout=output, stderr=errors, text=True) as launch:
                stamp_launch('spawnedAt')
                def launch_state():
                    nonlocal next_receipt_check, admitted
                    status = launch.poll()
                    if status is not None and lifecycle['launch']['completedAt'] is None:
                        stamp_launch('completedAt')
                        lifecycle['launch']['nativeReturnCode'] = status
                    if status is not None and status != 0:
                        print(f'sim-lane: Safari app launch failed in {time.monotonic() - started:.3f}s: '
                              f'{native_text(errors).strip()}', file=sys.stderr)
                        report_receipt_evidence()
                        return status if status > 0 else 128 - status
                    if admitted:
                        return 0
                    if time.monotonic() >= deadline:
                        print(f'sim-lane: Safari app launch timed out within {timeout:g}s readiness deadline; '
                              f'observed wall {time.monotonic() - started:.3f}s', file=sys.stderr)
                        for label, stream in (('stdout', output), ('stderr', errors)):
                            detail = native_text(stream).strip()
                            print(f'sim-lane: Safari timed-out launch {label}: {detail[-2048:] or "<empty>"}', file=sys.stderr)
                        report_receipt_evidence()
                        return LAUNCH_DEADLINE
                    if status == 0:
                        stamp_launch('ownedAt')
                        admitted = True
                        print(f'sim-lane: Safari app launched in {time.monotonic() - started:.3f}s: '
                              f'{native_text(output).strip()}', file=sys.stderr)
                        report_receipt_evidence()
                        return 0
                    if time.monotonic() >= next_receipt_check:
                        sample = time.monotonic()
                        # Snapshot our exact launch output, never a process census.
                        pid = owned_launch_pid(os.pread(output.fileno(), 4096, 0).decode(errors='replace'))
                        cost = (time.monotonic() - sample) * 1000
                        evidence['checks'] += 1
                        evidence['totalMs'] = round(evidence['totalMs'] + cost, 3)
                        evidence['maxMs'] = round(max(evidence['maxMs'], cost), 3)
                        next_receipt_check = time.monotonic() + .25
                        # The native read itself can cross the wall deadline. An
                        # earlier document cannot make that late launch proof valid.
                        if time.monotonic() >= deadline:
                            print('sim-lane: Safari launch receipt read crossed the readiness deadline', file=sys.stderr)
                            report_receipt_evidence()
                            return LAUNCH_DEADLINE
                        if pid is not None:
                            stamp_launch('ownedAt')
                            admitted = True
                            print(f'sim-lane: owned Safari launch receipt {pid} in {time.monotonic() - started:.3f}s before launch client replied; '
                                  'requiring owned frame proof', file=sys.stderr)
                            report_receipt_evidence()
                            return 0
                    return None
                try:
                    result = open_ready_page(udid, url, ready, deadline, timeout, started, launch_state, lifecycle['url'], screenshots, lifecycle['http'])
                    return result
                finally:
                    # Retire only our launch RPC, never the observed Safari app.
                    if launch.poll() is None:
                        stamp_launch('killAt')
                        launch.kill()
                        stamp_launch('reapRequestedAt')
                        launch.wait()
                    stamp_launch('reapedAt')
                    lifecycle['launch']['nativeReturnCode'] = getattr(launch, 'returncode', lifecycle['launch']['nativeReturnCode'])
    finally:
        if result is not None and result != 0 and time.monotonic() >= deadline:
            # Readiness has already refused. One bounded cleanup diagnostic
            # cannot reopen its deadline, alter its error or supply frame proof.
            screenshots.start('readiness-timeout')
        screenshots.finish()
        lifecycle.update(result=result, ownedLaunch=admitted,
                         ownedFrames=ready.is_set() if ready is not None else None,
                         recordedAt=round(time.monotonic() - started, 3), limitSeconds=timeout)
        try:
            print('sim-lane: Safari lifecycle receipt ' + json.dumps(lifecycle), file=sys.stderr, flush=True)
        except OSError:
            # A broken diagnostic sink cannot replace the native result or
            # an exception already propagating from the owned operation.
            pass


def wait_for_bootstatus(udid, remaining):
    # The shell supplies the remaining original admission budget. Importing
    # this one helper spends that budget; it cannot start a second full wait.
    deadline = IMPORT_STARTED + remaining
    budget = deadline - time.monotonic()
    if budget <= 0:
        print('sim-lane: bootstatus admission expired during Python imports', file=sys.stderr, flush=True)
        return 75
    started = time.monotonic()
    print('sim-lane: device bootstatus started', file=sys.stderr, flush=True)
    try:
        with bootstatus_transcript() as transcript:
            budget = deadline - time.monotonic()
            if budget <= 0:
                return 75
            result = subprocess.run([*SIMCTL_COMMAND, 'bootstatus', udid, '-b', '-d'],
                                    stdout=transcript, stderr=transcript, timeout=budget, check=False)
        code = result.returncode if result.returncode >= 0 else 128 - result.returncode
        if code == 0 and time.monotonic() >= deadline:
            print('sim-lane: bootstatus success observed after admission deadline', file=sys.stderr, flush=True)
            code = 75
    except subprocess.TimeoutExpired:
        print(f'sim-lane: bootstatus admission timed out; owned helper {os.getpid()}, parent {os.getppid()}, device {udid}',
              file=sys.stderr, flush=True)
        code = 75
    print(f'sim-lane: device bootstatus finished in {time.monotonic() - started:.3f}s (exit {code})',
          file=sys.stderr, flush=True)
    return code


def request_selected_presentation(remaining):
    """Retain the original GUI prerequisite after native cold migration.

    No new budget: imports, bootstatus and this request share the same
    deadline supplied by the shell. Success is not Safari/frame readiness.
    """
    developer = os.environ.get('DEVELOPER_DIR', '')
    executable = Path(developer) / 'usr/bin/simctl'
    if not os.path.isabs(developer) or not executable.is_file() or not os.access(executable, os.X_OK):
        print('sim-lane: selected Simulator presentation lost its toolchain binding', file=sys.stderr, flush=True)
        return 64
    presenter = str(Path(developer) / 'Applications/Simulator.app')
    deadline = IMPORT_STARTED + remaining
    budget = deadline - time.monotonic()
    if budget <= 0:
        return 75
    started = time.monotonic()
    print(f'sim-lane: requesting selected Simulator presentation host {presenter}', file=sys.stderr, flush=True)
    print('sim-lane: selected Simulator presentation request started', file=sys.stderr, flush=True)
    try:
        result = subprocess.run(['open', '-a', presenter], stdout=sys.stderr, timeout=budget, check=False)
        code = result.returncode if result.returncode >= 0 else 128 - result.returncode
        if code == 0 and time.monotonic() >= deadline:
            code = 75
    except subprocess.TimeoutExpired:
        code = 75
    print(f'sim-lane: selected Simulator presentation request finished in {time.monotonic() - started:.3f}s (exit {code})',
          file=sys.stderr, flush=True)
    return code


if __name__ == '__main__':
    print(f'sim-lane: Safari readiness Python imports finished in {time.monotonic() - IMPORT_STARTED:.3f}s', file=sys.stderr, flush=True)
    if (len(sys.argv) in (4, 5) and sys.argv[2] == '--bootstatus'
            and (len(sys.argv) == 4 or sys.argv[4] == '--present')):
        try:
            remaining = float(sys.argv[3])
        except ValueError:
            remaining = 0
        if not math.isfinite(remaining) or not 0 < remaining <= 300:
            print('sim-lane: invalid remaining bootstatus admission budget', file=sys.stderr)
            sys.exit(64)
        PREPARED_SCREENSHOTS = SafariScreenshots(sys.argv[1], 0)
        PREPARED_SCREENSHOTS.prepare(IMPORT_STARTED + remaining)
        code = wait_for_bootstatus(sys.argv[1], remaining)
        if code == 0 and len(sys.argv) == 5:
            code = request_selected_presentation(remaining)
        if code != 0:
            PREPARED_SCREENSHOTS.finish()
            sys.exit(code)
        print(f'sim-lane: bootstatus prerequisite accepted after {time.monotonic() - IMPORT_STARTED:.3f}s; starting original Safari proof deadline', file=sys.stderr)
    elif sys.argv[2:] == ['--await-bootstatus']:
        status = sys.stdin.readline().strip()
        if not status.isdecimal() or not 0 <= int(status) <= 255:
            print('sim-lane: missing or invalid bootstatus prerequisite', file=sys.stderr)
            sys.exit(64)
        if int(status) != 0:
            sys.exit(int(status))
        print(f'sim-lane: bootstatus prerequisite accepted after {time.monotonic() - IMPORT_STARTED:.3f}s; starting original Safari proof deadline', file=sys.stderr)
    elif sys.argv[2:]:
        print('sim-lane: invalid Safari readiness arguments', file=sys.stderr)
        sys.exit(64)
    try:
        result = wait_for_safari(sys.argv[1])
    finally:
        if PREPARED_SCREENSHOTS is not None:
            PREPARED_SCREENSHOTS.finish()
    sys.exit(result)
