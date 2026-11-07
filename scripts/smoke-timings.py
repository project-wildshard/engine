"""Record passive Actions clocks without changing a browser's verdict."""
import json
import os
from pathlib import Path
import subprocess
import sys


def record(directory, job, request=subprocess.run):
    directory.mkdir(parents=True, exist_ok=True)
    base = f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    queries = (
        ('workflow', base, '{created_at, run_started_at}'),
        ('job', base + '/jobs', '.jobs[] | select(.name == ' + json.dumps(job)
         + ') | {created_at, started_at, completed_at, runner_name, steps}'),
    )
    for name, endpoint, query in queries:
        try:
            result = request(['gh', 'api', endpoint, '--jq', query],
                             capture_output=True, text=True, check=False)
            if result.returncode == 0:
                # Keep the original projected API output for timing readers.
                (directory / f'{name}-timing.json').write_text(result.stdout)
                continue
            failure = {'available': False, 'exitCode': result.returncode,
                       'error': result.stderr, 'output': result.stdout}
        except OSError as error:
            failure = {'available': False, 'error': str(error)}
        (directory / f'{name}-timing.json').write_text(json.dumps(failure))
        print(f'Passive {name} timing unavailable: {json.dumps(failure)}', file=sys.stderr)


if __name__ == '__main__':
    record(Path('boot-smoke-results'), sys.argv[1])
