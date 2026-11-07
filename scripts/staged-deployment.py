#!/usr/bin/env python3
"""Optional protected production staging; never substitutes for source CI."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

REPOSITORY = 'project-wildshard/engine'


def report(value, stream=None):
    try:
        print(value, file=sys.stdout if stream is None else stream)
    except OSError:
        pass  # Passive logging cannot replace an actual native result.


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class NativeFailure(RuntimeError):
    def __init__(self, code):
        super().__init__('Native command refused with code ' + str(code))
        self.code = code if code > 0 else 128 - code


def identity(sha, run, attempt, project, team):
    if (not re.fullmatch('[0-9a-f]{40}', sha)
            or not re.fullmatch('[1-9][0-9]*', run)
            or not re.fullmatch('[1-9][0-9]*', attempt)
            or not re.fullmatch('prj_[A-Za-z0-9]+', project)
            or not re.fullmatch('team_[A-Za-z0-9]+', team)):
        raise ValueError('Invalid staged source/project identity')


def unique_url(value):
    if not isinstance(value, str):
        raise ValueError('Missing unique deployment URL')
    url = urlsplit(value)
    if (url.scheme != 'https' or url.username is not None or url.password is not None
            or url.port is not None or url.path not in ('', '/') or url.query or url.fragment
            or not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*\\.vercel\\.app', url.hostname or '')):
        raise ValueError('Invalid unique deployment URL')
    return 'https://' + url.hostname


def build_matches(build, sha):
    if not isinstance(build, str):
        return False
    short, separator, suffix = build.partition('-')
    return (separator == '-' and re.fullmatch('[0-9a-f]{7,40}', short) is not None
            and sha.startswith(short) and re.fullmatch('[a-z0-9-]+', suffix) is not None)


def protected_status(code, location):
    if code in (401, 403):
        return True
    if code != 302 or not isinstance(location, str):
        return False
    try:
        url = urlsplit(location)
        return (url.scheme == 'https' and url.hostname == 'vercel.com'
                and url.port is None and url.username is None and url.password is None
                and url.path == '/sso-api' and not url.fragment)
    except ValueError:
        return False


def probe(url, path):
    base = unique_url(url)
    if not isinstance(path, str) or not path.startswith('/') or path.startswith('//'):
        raise ValueError('Invalid protected path')
    opener = build_opener(NoRedirect())
    request = Request(base + path, headers={'Cache-Control': 'no-store'})
    try:
        response = opener.open(request, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        code, location = response.status, response.headers.get('Location')
    # Never follow a redirect, carry auth, or read a body for this observation.
    if not protected_status(code, location):
        raise ValueError('Staged unique URL protection refused: HTTP ' + str(code))
    return {'path': path, 'status': code,
            'challenge': 'vercel-sso' if code == 302 else 'http-auth'}


def native(args):
    process = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if process.stderr:
        try:
            sys.stderr.write(process.stderr)
        except OSError:
            pass
    if process.returncode != 0:
        # Do not print argv: native CLI arguments contain the existing token.
        raise NativeFailure(process.returncode)
    if len(process.stdout) > 1024 * 1024:
        raise ValueError('Oversized staged native response')
    return process.stdout.strip()


def deployment(deployment_id, team, token):
    if not re.fullmatch('dpl_[A-Za-z0-9]+', deployment_id):
        raise ValueError('Invalid exact deployment ID')
    request = Request('https://api.vercel.com/v13/deployments/' + deployment_id + '?' + urlencode({'teamId': team}),
                      headers={'Authorization': 'Bearer ' + token})
    with build_opener(NoRedirect()).open(request, timeout=15) as response:
        body = response.read(1024 * 1024 + 1)
    if len(body) > 1024 * 1024:
        raise ValueError('Oversized staged deployment record')
    return json.loads(body)


def map_inventory():
    paths = [Path('dist/version.json'), Path('dist/.vite/chunk-modules.json')]
    paths += sorted(path for path in Path('dist').rglob('*') if re.search(r'\.map(?:\.(?:gz|br))?$', path.name))
    rows = []
    for path in paths:
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing regular original map member')
        body = path.read_bytes()
        rows.append({'path': path.relative_to('dist').as_posix(), 'bytes': len(body),
                     'hash': hashlib.sha256(body).hexdigest()})
    if len(rows) <= 2:
        raise ValueError('Missing full original maps')
    body = json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()
    return {'manifestHash': hashlib.sha256(body).hexdigest(), 'files': len(rows),
            'mapFiles': len(rows) - 2, 'bytes': sum(row['bytes'] for row in rows),
            'versionHash': rows[0]['hash']}


def artifact(receipt):
    artifact_id = receipt['maps']['artifactId']
    token = os.environ.get('GH_TOKEN', '')
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    if not token or repo != REPOSITORY:
        raise ValueError('Missing exact maps artifact reader')
    request = Request('https://api.github.com/repos/' + repo + '/actions/artifacts/' + artifact_id,
                      headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
    with build_opener(NoRedirect()).open(request, timeout=15) as response:
        body = response.read(65537)
    if len(body) > 65536:
        raise ValueError('Oversized maps artifact record')
    return json.loads(body)


def admitted_artifact(record, receipt):
    maps = receipt['maps']
    if (not isinstance(record, dict) or str(record.get('id')) != maps['artifactId']
            or record.get('name') != 'production-source-maps-' + receipt['sha']
            or record.get('expired') is not False or type(record.get('size_in_bytes')) is not int
            or record['size_in_bytes'] <= 0 or record.get('digest') != maps['artifactDigest']):
        raise ValueError('Finalized staged map artifact differs or disappeared')
    run = record.get('workflow_run')
    if (not isinstance(run, dict) or str(run.get('id')) != receipt['run']
            or run.get('head_sha') != receipt['sha'] or run.get('head_branch') != 'main'):
        raise ValueError('Staged map artifact source differs')


def stage_jobs(receipt):
    token = os.environ.get('GH_TOKEN', '')
    if not token or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise ValueError('Missing actual optional stage verdict reader')
    url = ('https://api.github.com/repos/' + REPOSITORY + '/actions/runs/' + receipt['run']
           + '/attempts/' + receipt['attempt'] + '/jobs?per_page=100')
    request = Request(url, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
    with build_opener(NoRedirect()).open(request, timeout=15) as response:
        body = response.read(1024 * 1024 + 1)
    if len(body) > 1024 * 1024:
        raise ValueError('Oversized actual stage verdict response')
    return json.loads(body)


def successful_stage(record, receipt):
    if (not isinstance(record, dict) or not isinstance(record.get('jobs'), list)
            or type(record.get('total_count')) is not int
            or record['total_count'] != len(record['jobs']) or not 0 < record['total_count'] <= 100
            or any(not isinstance(row, dict) for row in record['jobs'])):
        raise ValueError('Incomplete actual stage verdict inventory')
    rows = [row for row in record['jobs'] if row.get('name') == 'stage-prebuilt']
    if len(rows) != 1:
        raise ValueError('Actual stage verdict is missing or duplicated')
    job = rows[0]
    if (job.get('status') != 'completed' or job.get('conclusion') != 'success'
            or str(job.get('run_id')) != receipt['run'] or str(job.get('run_attempt')) != receipt['attempt']
            or job.get('head_sha') != receipt['sha']):
        raise ValueError('Actual stage job did not succeed for this exact source attempt')


def admitted(record, receipt, project, team):
    if (not isinstance(record, dict) or record.get('id') != receipt['deployment']
            or record.get('projectId') != project
            or record.get('ownerId') != team
            or record.get('target') != 'production' or record.get('readyState') != 'READY'
            or unique_url('https://' + record.get('url', '')) != receipt['url']):
        raise ValueError('Staged deployment identity/target/readiness differs')
    meta = record.get('meta')
    expected = {'ciStageSha': receipt['sha'], 'ciStageRun': receipt['run'],
                'ciStageAttempt': receipt['attempt'], 'ciStageBuild': receipt['build'],
                'ciStageArchive': receipt['archiveHash'], 'ciStageMaps': receipt['maps']['manifestHash']}
    if not isinstance(meta, dict) or any(meta.get(key) != value for key, value in expected.items()):
        raise ValueError('Staged deployment source metadata differs')


def receipt_value(value, sha, run, attempt, project, team):
    identity(sha, run, attempt, project, team)
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError('Missing bounded stage receipt')
    receipt = json.loads(value)
    if not isinstance(receipt, dict) or set(receipt) != {
            'version', 'sha', 'run', 'attempt', 'deployment', 'url',
            'build', 'archiveHash', 'privateMapPath', 'probes', 'maps'}:
        raise ValueError('Staged receipt shape differs')
    if (type(receipt['version']) is not int or receipt['version'] != 1 or receipt['sha'] != sha or receipt['run'] != run
            or receipt['attempt'] != attempt
            or not isinstance(receipt['deployment'], str) or not re.fullmatch('dpl_[A-Za-z0-9]+', receipt['deployment'])
            or not build_matches(receipt['build'], sha)
            or not isinstance(receipt['archiveHash'], str) or not re.fullmatch('[0-9a-f]{64}', receipt['archiveHash'])
            or not isinstance(receipt['privateMapPath'], str)
            or not re.fullmatch('/[A-Za-z0-9_./-]+\\.map(?:\\.(?:br|gz))?', receipt['privateMapPath'])
            or '/..' in receipt['privateMapPath']):
        raise ValueError('Staged receipt source differs')
    if unique_url(receipt['url']) != receipt['url']:
        raise ValueError('Noncanonical stage URL')
    maps = receipt['maps']
    if (not isinstance(maps, dict) or set(maps) != {'artifactId', 'artifactDigest', 'manifestHash', 'files', 'mapFiles', 'bytes', 'versionHash'}
            or not isinstance(maps['artifactId'], str) or not re.fullmatch('[1-9][0-9]*', maps['artifactId'])
            or not isinstance(maps['artifactDigest'], str) or not re.fullmatch('sha256:[0-9a-f]{64}', maps['artifactDigest'])
            or not isinstance(maps['manifestHash'], str) or not re.fullmatch('[0-9a-f]{64}', maps['manifestHash'])
            or not isinstance(maps['versionHash'], str) or not re.fullmatch('[0-9a-f]{64}', maps['versionHash'])
            or type(maps['mapFiles']) is not int or maps['mapFiles'] <= 0
            or type(maps['files']) is not int or maps['files'] != maps['mapFiles'] + 2
            or type(maps['bytes']) is not int or maps['bytes'] <= 0):
        raise ValueError('Missing bounded finalized map identity/count/hash')
    if (not isinstance(receipt['probes'], list) or len(receipt['probes']) != 2
            or any(not isinstance(row, dict) for row in receipt['probes'])
            or [row.get('path') for row in receipt['probes']] != ['/', receipt['privateMapPath']]
            or any(row.get('status') not in (302, 401, 403) for row in receipt['probes'])):
        raise ValueError('Missing staged protected probe')
    return receipt


def emit(name, value):
    if not re.fullmatch('[a-z_]+', name) or '\n' in value or '\r' in value:
        raise ValueError('Invalid stage output')
    output = os.environ.get('GITHUB_OUTPUT')
    if output is None:
        raise ValueError('Missing owned CI output')
    with open(output, 'a', encoding='utf8') as stream:
        stream.write(name + '=' + value + '\n')


def restore_and_install(args, run=subprocess.run):
    """The original frozen artifact restore and pinned install, concurrently.

    Both native results remain visible; restore retains precedence if both
    branches fail. No retry, skipped validation or new artifact authority.
    """
    def restore():
        directory = os.environ.get('PREBUILT_ARCHIVE', '')
        mode, started = 'provided', time.monotonic()
        if not directory:
            directory, mode = 'prebuilt-output', 'gh-run-download'
            result = run(['gh', 'run', 'download', args.run, '--repo', os.environ['GITHUB_REPOSITORY'],
                          '--name', 'vercel-prebuilt', '--dir', directory])
            if result.returncode != 0:
                return result.returncode
        env = dict(os.environ, PREBUILT_DOWNLOAD_MODE=mode,
                   PREBUILT_DOWNLOAD_SECONDS=str(int(time.monotonic() - started)))
        result = run(['python3', str(Path(__file__).with_name('prebuilt-output.py')), 'restore',
                      '--sha', args.sha, '--run', args.run, '--directory', directory, '--timings'], env=env)
        return result.returncode

    def install():
        return run(['npm', 'install', '--global', 'vercel@59.11.2']).returncode

    with ThreadPoolExecutor(max_workers=2) as pool:
        restored = pool.submit(restore)
        installed = pool.submit(install)
        # Always collect both actual native outcomes, without retrying either.
        restore_code, install_code = restored.result(), installed.result()
    report(json.dumps({'report': 'ci2-restore-cli-overlap', 'sha': args.sha, 'run': args.run,
                      'restoreCode': restore_code, 'installCode': install_code}))
    if restore_code != 0 or install_code != 0:
        raise NativeFailure(restore_code if restore_code != 0 else install_code)


def select(args, read=deployment, check=probe, read_artifact=artifact, read_stage=stage_jobs):
    if os.environ.get('STAGE_RESULT') != 'success':
        raise ValueError('Actual optional stage verdict did not succeed')
    receipt = receipt_value(os.environ.get('STAGED_RECEIPT', ''), args.sha, args.run,
                            args.attempt, args.project, args.team)
    # Report-only aggregation must not turn a failed actual job with retained
    # output into promotion authority. This bounded read never proves CI gates.
    successful_stage(read_stage(receipt), receipt)
    admitted(read(receipt['deployment'], args.team, args.token), receipt, args.project, args.team)
    admitted_artifact(read_artifact(receipt), receipt)
    for path in ('/', receipt['privateMapPath']):
        check(receipt['url'], path)
    return receipt


def stage(args, run=native, read=deployment, check=probe):
    identity(args.sha, args.run, args.attempt, args.project, args.team)
    proof = json.loads(Path(args.proof).read_text())
    if proof.get('sha') != args.sha or str(proof.get('run')) != args.run:
        raise ValueError('Staged prebuilt proof source differs')
    archive_hash = proof.get('archiveHash')
    if not isinstance(archive_hash, str) or not re.fullmatch('[0-9a-f]{64}', archive_hash):
        raise ValueError('Missing exact prebuilt archive hash')
    version = json.loads(Path('dist/version.json').read_text())
    static = json.loads(Path('.vercel/output/static/version.json').read_text())
    if version != static or not build_matches(version.get('build'), args.sha):
        raise ValueError('Staged version differs from exact restored artifact')
    maps = sorted(path for path in Path('dist').rglob('*.map') if path.is_file())
    if not maps:
        raise ValueError('Missing original private maps')
    private_map = '/' + maps[0].relative_to('dist').as_posix()
    # This is the same public-map stripper used by the original publisher.
    inventory = map_inventory()
    run(['node', 'scripts/deploy-source-maps.mjs', '.vercel/output/static'])
    meta = {'ciStageSha': args.sha, 'ciStageRun': args.run, 'ciStageAttempt': args.attempt,
            'ciStageBuild': version['build'], 'ciStageArchive': archive_hash,
            'ciStageMaps': inventory['manifestHash']}
    command = ['vercel', 'deploy', '--prebuilt', '--target=production', '--skip-domain', '--yes',
               '--scope', 'raynos-projects', '--token', args.token]
    for key, value in meta.items():
        command += ['--meta', key + '=' + value]
    url = unique_url(run(command))
    # inspect returns the immutable ID; the API read below also verifies full
    # project and source metadata omitted by the CLI's formatted JSON output.
    info = json.loads(run(['vercel', 'inspect', url, '--json', '--scope', 'raynos-projects', '--token', args.token]))
    receipt = {'version': 1, 'sha': args.sha, 'run': args.run, 'attempt': args.attempt,
               'deployment': info.get('id'), 'url': url,
               'build': version['build'], 'archiveHash': archive_hash, 'privateMapPath': private_map,
               'probes': [], 'maps': inventory}
    admitted(read(receipt['deployment'], args.team, args.token), receipt, args.project, args.team)
    receipt['probes'] = [check(url, path) for path in ('/', private_map)]
    emit('receipt', json.dumps(receipt, separators=(',', ':')))
    report(json.dumps({'report': 'ci2-stage', 'sha': args.sha, 'run': args.run,
                      'deployment': receipt['deployment'], 'url': url, 'build': receipt['build'], 'probes': receipt['probes']}))


def complete(args, read_artifact=artifact):
    # Expose a promotion receipt only after the maps action has finalized its
    # canonical same-source artifact. A partial stage leaves no usable output.
    raw = os.environ.get('STAGED_RECEIPT', '')
    if len(raw) > 8192:
        raise ValueError('Oversized partial stage receipt')
    receipt = json.loads(raw)
    if not isinstance(receipt, dict):
        raise ValueError('Missing partial stage receipt')
    inventory = map_inventory()
    if receipt.get('maps') != inventory:
        raise ValueError('Original map bytes changed during stage')
    digest = os.environ.get('MAP_ARTIFACT_DIGEST', '')
    if re.fullmatch('[0-9a-f]{64}', digest):
        digest = 'sha256:' + digest
    receipt['maps'] = dict(inventory, artifactId=os.environ.get('MAP_ARTIFACT_ID', ''), artifactDigest=digest)
    receipt = receipt_value(json.dumps(receipt), args.sha, args.run, args.attempt, args.project, args.team)
    admitted_artifact(read_artifact(receipt), receipt)
    emit('receipt', json.dumps(receipt, separators=(',', ':')))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('stage', 'complete', 'select', 'promote', 'restore-install'))
    parser.add_argument('--sha', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--attempt', required=True)
    parser.add_argument('--proof', default='prebuilt-output/proof.json')
    args = parser.parse_args()
    args.project, args.team = os.environ.get('VERCEL_PROJECT_ID', ''), os.environ.get('VERCEL_ORG_ID', '')
    args.token = os.environ.get('VERCEL_BUILD_TOKEN', '')
    if args.mode in ('stage', 'select', 'promote') and not args.token:
        raise ValueError('Missing existing deployment credential')
    identity(args.sha, args.run, args.attempt, args.project, args.team)
    started = time.monotonic()
    if args.mode == 'restore-install':
        restore_and_install(args)
    elif args.mode == 'stage':
        stage(args)
    elif args.mode == 'complete':
        complete(args)
    elif args.mode == 'select':
        try:
            receipt = select(args)
            emit('promote', 'true')
            emit('receipt', json.dumps(receipt, separators=(',', ':')))
            emit('build', receipt['build'])
        except (ValueError, OSError, RuntimeError, KeyError, TypeError) as error:
            # An optional stage can only remove the optimization, never source
            # proof or the original fallback path.
            report('Optional staged optimization refused: ' + type(error).__name__)
            emit('promote', 'false')
    else:
        if (os.environ.get('GITHUB_EVENT_NAME') != 'push' or os.environ.get('GITHUB_REF') != 'refs/heads/main'
                or os.environ.get('GITHUB_SHA') != args.sha or os.environ.get('GITHUB_RUN_ID') != args.run
                or os.environ.get('RELEASE_ALLOWED') != 'true'
                or os.environ.get('STAGE_RESULT') != 'success'
                or os.environ.get('STAGED_SELECTED') != 'true'
                or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY):
            raise ValueError('Promotion lacks the exact green main publisher admission')
        # Selection already performed the bounded live deployment, protection
        # and finalized-map checks and chose the original fallback on refusal.
        # Do not turn a second optional probe into a late release failure.
        receipt = receipt_value(os.environ.get('STAGED_RECEIPT', ''), args.sha, args.run,
                                args.attempt, args.project, args.team)
        native(['vercel', 'promote', receipt['deployment'], '--yes', '--scope', 'raynos-projects', '--token', args.token])
        report('deployed ' + receipt['url'] + ' for ' + args.sha + ' (the pin)')
    report(json.dumps({'report': 'ci2-stage-controller', 'mode': args.mode, 'sha': args.sha,
                      'run': args.run, 'seconds': time.monotonic() - started}))


if __name__ == '__main__':
    try:
        main()
    except NativeFailure as error:
        report(str(error), stream=sys.stderr)
        sys.exit(error.code)
    except (ValueError, OSError, RuntimeError, KeyError, TypeError) as error:
        report('Staged deployment refused: ' + type(error).__name__, stream=sys.stderr)
        sys.exit(1)
