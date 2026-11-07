#!/usr/bin/env python3
"""C4: report each CI command's own verdict and clean up only its process group."""
from collections import deque
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
from urllib.parse import unquote

ANSI = re.compile(r'\x1b\[[0-9;]*m')
ROOT = r'(?:src|scripts|test|admin|api|drafts|lint|vite)/'
EXTENSION = r'\.(?:json|[cm]?[jt]sx?|py|sh|mjs|css)'
FILE = ROOT+r'[^\s():\x1b,=]+?'+EXTENSION+r'\b'
QUOTED_FILE = r'[\'\"]('+ROOT+r'[^\'\"\r\n]+?'+EXTENSION+r')[\'\"]'
ANNOTATION = re.compile(r'::error(?: ([^\r\n]*?))?::')


def repository_file(file):
    """Vitest annotations may name an absolute path in this exact checkout."""
    relative=os.path.relpath(file,os.environ.get('GITHUB_WORKSPACE') or os.getcwd()) if os.path.isabs(file) else file
    return relative if '..' not in relative.split('/') and re.match(ROOT,relative) else None


def failure_files(output, primary_only=False):
    plain = ANSI.sub('', output)
    annotated, lines = [], []
    for line in plain.splitlines():
        annotation = ANNOTATION.search(line)
        if annotation:
            # Split annotation properties BEFORE decoding escaped commas. A
            # title is metadata, never a suffix of the file sent to Git.
            properties = dict(item.split('=', 1) for item in (annotation[1] or '').split(',') if '=' in item)
            if properties.get('file'):
                annotated.append(unquote(properties['file']))
                continue
            line = line[annotation.end():]
        lines.append(line)
    primary = [line for line in lines if re.search(r'\bFAIL\s|\berror (?:TS\d+|\[)|\berror\[|Error:|error:', line)]
    def extract(text):
        return re.findall(QUOTED_FILE, text) + re.findall(FILE, text)
    found = sorted(set(annotated + extract('\n'.join(primary))))
    paths=(repository_file(file) for file in (found if found or primary_only else extract('\n'.join(lines))))
    return sorted({file for file in paths if file is not None})[:16]


def escape(value):
    return str(value).replace('%','%25').replace('\r','%0D').replace('\n','%0A').replace(',','%2C').replace(':','%3A')


def print_culprits(files):
    """Advisory exact-history attribution, bounded independently of the red check."""
    try:
        result=subprocess.run(['node',str(Path(__file__).with_name('ci-culprits.mjs')),
            '--sha='+os.environ.get('GITHUB_SHA',''),'--files='+json.dumps(files[:16])],
            text=True,capture_output=True,timeout=35)
        if result.returncode:
            prefix='CI culprit report unavailable: '
            reason=next((line[len(prefix):] for line in result.stderr.splitlines()
                         if line.startswith(prefix)), '')[:240]
            # Only our helper's first diagnostic line, never arbitrary child
            # output or another workflow annotation, belongs in this warning.
            print('::warning::CI culprit report unavailable: helper exited '+str(result.returncode)+
                  ('; '+escape(reason) if reason else '')+
                  '; original check remains red; no retry',flush=True)
            return
        row=json.loads(result.stdout)
        if not re.fullmatch(r'[0-9a-f]{40}',row['base']) or len(row['candidates'])>3:
            raise ValueError('invalid culprit report')
        print('::group::CF4 likely culprit commits',flush=True)
        print('Last green main push: '+row['base'],flush=True)
        for candidate in row['candidates']:
            print('Candidate '+escape(candidate['sha'])+' ['+escape(candidate['match'])+'] '+
                escape(candidate['subject'])+' | Assisted-by: '+escape(candidate['assistedBy']),flush=True)
        if not row['candidates']:
            print('No commit in this range touches the failing files or their literal imports.',flush=True)
        if row['missingImports']:
            print('Unresolved/absent committed inputs: '+escape(', '.join(row['missingImports'][:10])),flush=True)
        print('::endgroup::',flush=True)
    except (OSError,ValueError,KeyError,TypeError,RuntimeError,subprocess.SubprocessError) as error:
        print('::warning::CI culprit report unavailable: '+escape(type(error).__name__)+
            '; original check remains red; no retry',flush=True)


def diagnose(output, code, record=True, observed=()):
    # A completed primary failure outranks unrelated file mentions in the tail.
    # Preserve the first bounded cause set even after its raw lines roll out.
    files = sorted(list(dict.fromkeys([*observed,*failure_files(output,primary_only=bool(observed))]))[:16])
    label = 'Check exited '+str(code)
    for file in files:
        print('::error file=%s::%s: %s' % (escape(file), escape(label), escape(file)), flush=True)
    if not files:
        print('::error::'+escape(label)+'; see command output for the failing input', flush=True)
    if record:
        directory=Path('tmp/ci-failures');directory.mkdir(parents=True,exist_ok=True)
        job=os.environ.get('GITHUB_JOB','check')
        # One runner owns this file. Failure metadata has no credentials/log text.
        (directory/'failure.json').write_text(json.dumps({'at':time.time(),'sha':os.environ.get('GITHUB_SHA'),
            'run':os.environ.get('GITHUB_RUN_ID'),'job':job,'files':files,'peer':None})+'\n')
        if files and os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_RUN_ID'):
            print_culprits(files)
    return files


def stop(child):
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    except ProcessLookupError:
        child.wait()


def run(command, record=True):
    """Drain output live and retain the command's original failure."""
    output=deque(maxlen=2000)
    observed=[]
    def remember(lines):
        output.extend(lines)
        for line in lines:
            if len(observed)>=16:
                break
            for file in failure_files(line,primary_only=True):
                if file not in observed:
                    observed.append(file)
                    if len(observed)>=16:
                        break
    with subprocess.Popen(command,stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,start_new_session=True,bufsize=0) as child:
        selector=selectors.DefaultSelector()
        selector.register(child.stdout,selectors.EVENT_READ)
        pending=''
        try:
            while selector.get_map():
                for key, _ in selector.select(timeout=.1):
                    chunk=os.read(key.fd,65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    text=chunk.decode('utf8',errors='replace')
                    print(text,end='',flush=True)
                    lines=(pending+text).split('\n');pending=lines.pop()
                    remember(lines)
            if pending:
                remember([pending])
            code=child.wait()
        except BaseException:
            stop(child)
            raise
        finally:
            selector.close()
    if code:
        diagnose('\n'.join(output),code,record,observed)
        return code if code > 0 else 1
    return 0


def main():
    args=sys.argv[1:]
    if args[:1]==['--']:
        args=args[1:]
    if not args:
        raise SystemExit('usage: ci-fail-fast.py -- <command...>')
    def interrupted(number, frame):
        raise SystemExit(128+number)
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number,interrupted)
    raise SystemExit(run(args))


if __name__=='__main__':
    main()
