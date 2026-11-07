"""C4 command ownership and failure reporting; no GitHub calls or app builds."""
import contextlib
import io
import json
import os
import re
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

API=runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts' / 'ci-fail-fast.py'))


class FailFastTests(unittest.TestCase):
    def test_failures_name_actual_test_and_type_inputs(self):
        self.assertEqual(API['failure_files']('\x1b[31m FAIL test/real-case.test.ts > case\x1b[0m'),['test/real-case.test.ts'])
        self.assertEqual(API['failure_files']('src/format/row.ts(2,4): error TS2322: bad'),['src/format/row.ts'])
        self.assertEqual(API['failure_files']('unknown command failed'),[])

    def test_stylesheet_errors_remain_attributable_without_nonblocking_warnings(self):
        output='warn: src/engine/ui/styles/perf.css:4: unowned class\nerror: src/client/engine/ui/styles/menu.css:8: wrong owner'
        self.assertEqual(API['failure_files'](output),['src/client/engine/ui/styles/menu.css'])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(API['run']([sys.executable,'-c','print('+repr(output)+');raise SystemExit(1)'],record=False),1)
        self.assertIn('::error file=src/client/engine/ui/styles/menu.css',out.getvalue())
        self.assertNotIn('::error file=src/engine/ui/styles/perf.css',out.getvalue())

    def test_existing_source_guards_use_the_same_reporter(self):
        source=Path('.github/workflows/deploy.yml').read_text()
        for command,count in [('check-css.mjs',1),('no-binary-json.mjs --all',1),('check-closed-components.mjs',1)]:
            with self.subTest(command=command):
                self.assertEqual(source.count('run: python3 scripts/ci-fail-fast.py -- node scripts/'+command+'\n'),count)
                self.assertNotIn('run: node scripts/'+command+'\n',source)

    def test_one_prepare_publishes_exact_inputs_and_builds_without_download_or_regeneration(self):
        source = Path('.github/workflows/deploy.yml').read_text()
        prepare = source.split('\n  prepare:\n', 1)[1].split('\n  native-escape:\n', 1)[0]
        generation = 'node scripts/gen.mjs --reuse'
        # The fixtures runner publishes constructor inputs and optional snapshots;
        # prepare alone packs and publishes products.
        fixtures = source.split('\n  fixtures:\n', 1)[1].split('\n  behaviour:\n', 1)[0]
        self.assertEqual(source.count(generation), 2)
        self.assertEqual(prepare.count(generation), 1)
        self.assertEqual(fixtures.count(generation), 1)
        self.assertNotIn('ci-products.py pack', fixtures)
        uploads = re.findall(r'      - uses: actions/upload-artifact@v4\n([\s\S]*?)(?=\n      - |\Z)', fixtures)
        self.assertEqual(len(uploads), 2)
        self.assertEqual([re.search(r'          name: (\S+)', upload).group(1)
                          for upload in uploads], ['native-fixtures', 'test-fixtures'])
        self.assertIn('path: tmp/ci-native-fixtures/native-fixtures.bundle.json', uploads[0])
        self.assertIn('path: test-fixtures.tar.zst', uploads[1])
        for upload in uploads:
            self.assertIn("if: steps.admission.outputs.run == 'true'", upload)
            self.assertIn('if-no-files-found: error', upload)
        publisher = fixtures.split('      - name: Publish source-host native constructor inputs\n', 1)[1].split('      - uses:', 1)[0]
        self.assertIn('scripts/ci-native-fixtures.mjs build', publisher)
        self.assertNotIn('continue-on-error', publisher)
        self.assertNotIn('if !', publisher)
        self.assertIn('if ! WS_FIXTURE_SNAPSHOT_WRITE=', fixtures)
        self.assertIn('A fixture snapshot writer failed; shards compute that fixture', fixtures)
        self.assertNotIn('node scripts/build-shardfiles.mjs', prepare)
        self.assertNotIn('node scripts/gen.mjs --inputs-only', prepare)
        self.assertNotIn('  generated-inputs:', source)
        self.assertNotIn('  products:', source)
        self.assertNotIn('gh run download', prepare)
        self.assertIn('python3 scripts/ci-products.py pack', prepare)
        self.assertIn('zstd --long=27 -3 -T2 --keep test-products.tar', prepare)
        self.assertIn('scripts/ci-checks.mjs --prepared', prepare)
        self.assertLess(prepare.index(generation), prepare.index('scripts/ci-products.py pack'))
        self.assertLess(prepare.index('scripts/ci-products.py pack'), prepare.index('scripts/ci-checks.mjs --prepared'))
        for name in ('typecheck-lint', 'behaviour'):
            # Job extraction stops only at the next job, not deeper step fields.
            lines = source.split('\n  '+name+':\n', 1)[1].splitlines()
            end = next((i for i, line in enumerate(lines) if line.startswith('  ')
                        and not line.startswith('   ') and line.endswith(':')), len(lines))
            job = '\n'.join(lines[:end])
            self.assertIn('needs: [prepare, fixtures]' if name == 'behaviour' else 'needs: prepare', job)
            self.assertIn('name: test-products', job)
            self.assertIn('python3 scripts/ci-products.py unpack', job)
            self.assertNotIn('node scripts/gen.mjs', job)
            self.assertNotIn('node scripts/build-app.mjs', job)

    def test_annotation_properties_are_not_part_of_the_file(self):
        output='::error file=test/script-v2-strip.test.ts,title=test/script-v2-strip.test.ts::Error: missing input'
        self.assertEqual(API['failure_files'](output),['test/script-v2-strip.test.ts'])
        encoded='::error file=test/space%2C%20%5Bcase%5D.test.ts,title=ignored.ts::Error: actual input'
        self.assertEqual(API['failure_files'](encoded),['test/space, [case].test.ts'])
        self.assertEqual(API['failure_files']('Error: missing "test/space, [case].test.ts"'),['test/space, [case].test.ts'])

    def test_absolute_runner_annotations_resolve_only_inside_exact_checkout(self):
        workspace='/home/runner/work/project/project'
        output='::error file='+workspace+'/test/elite-entry-producer.test.ts::Error: actual input\nFAIL test/elite-entry-producer.test.ts > actual'
        with patch.dict(os.environ,{'GITHUB_WORKSPACE':workspace}):
            self.assertEqual(API['failure_files'](output),['test/elite-entry-producer.test.ts'])
            self.assertEqual(API['failure_files']('::error file=/other/test/foreign.test.ts::Error: unrelated'),[])
            self.assertEqual(API['failure_files']('::error file='+workspace+'/../test/escape.test.ts::Error: unrelated'),[])
        with patch.dict(os.environ,{'GITHUB_WORKSPACE':''}):
            self.assertEqual(API['failure_files']('::error file='+str(Path.cwd()/'test/local.test.ts')+'::Error: local'),['test/local.test.ts'])

    def test_culprit_paths_are_one_json_argument_without_shell_interpretation(self):
        report=API['print_culprits'];files=['test/space, [case].test.ts']
        row={'base':'a'*40,'candidates':[],'missingImports':[]}
        with patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(row),'')) as command, \
                contextlib.redirect_stdout(io.StringIO()):
            report(files)
        args=command.call_args.args[0]
        self.assertEqual(json.loads(next(arg[8:] for arg in args if arg.startswith('--files='))),files)
        self.assertNotIn('shell',command.call_args.kwargs)

    def test_success_retains_output_and_exit_code_without_metadata(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(API['run']([sys.executable,'-c','print("real success")'],record=False),0)
        self.assertIn('real success',out.getvalue())
        self.assertNotIn('::error',out.getvalue())

    def test_nonzero_check_keeps_red_and_names_file(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(API['run']([sys.executable,'-c','print("FAIL test/real.test.ts > actual");raise SystemExit(7)'],record=False),7)
        self.assertIn('::error file=test/real.test.ts',out.getvalue())

    def test_early_failure_path_survives_verbose_output_without_promoting_warnings(self):
        command='print("warn: src/engine/warning.ts");print("FAIL test/first-red.test.ts > actual");'+\
                'print("\\n".join("ordinary drain line "+str(i) for i in range(2500)));'+\
                'print("informational src/engine/not-a-failure.ts");raise SystemExit(7)'
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(API['run']([sys.executable,'-c',command],record=False),7)
        text=out.getvalue()
        self.assertIn('ordinary drain line 2499',text)
        self.assertTrue('::error file=test/first-red.test.ts' in text,'early primary failure path was lost')
        self.assertNotIn('::error file=src/engine/warning.ts',text)
        self.assertNotIn('::error file=src/engine/not-a-failure.ts',text)

    def test_streamed_cause_memory_retains_only_sixteen_paths_and_success_stays_success(self):
        command='print("\\n".join("FAIL test/early-%02d.test.ts > actual"%i for i in range(20)));'+\
                'print("\\n".join("drain" for _ in range(2500)));print("FAIL test/aaa-late.test.ts > late");raise SystemExit(1)'
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(API['run']([sys.executable,'-c',command],record=False),1)
        files=re.findall(r'::error file=([^:]+)::',out.getvalue())
        self.assertEqual(files,['test/early-%02d.test.ts'%i for i in range(16)])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(API['run']([sys.executable,'-c',command.replace('SystemExit(1)','SystemExit(0)')],record=False),0)
        self.assertNotIn('::error',out.getvalue())

    def test_source_publication_red_uses_existing_reporter(self):
        source=Path('.github/workflows/deploy.yml').read_text()
        step=source.split('      - name: Verify committed source tables after generation\n',1)[1].split('\n      - ',1)[0]
        self.assertEqual(step.strip(),'run: python3 scripts/ci-fail-fast.py -- node scripts/committed-source-tables.mjs --check --after-publication')
        message='Error: Committed source output differs: src/client/game/boot/bytes.generated.ts'
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(API['run']([sys.executable,'-c','print('+repr(message)+');raise SystemExit(1)'],record=False),1)
        self.assertIn(message,out.getvalue())
        self.assertIn('::error file=src/client/game/boot/bytes.generated.ts',out.getvalue())

    def test_every_ci_job_finishes_its_own_verdict_without_peer_io(self):
        main=API['main'];run=API['run']
        jobs=('behaviour','native-escape','prepare','typecheck-lint',
              'build-and-deploy','journeys','phone-route','boot-verdict')
        payload=json.dumps({'total_count':1,'jobs':[dict(name='foreign red',
            conclusion='failure',completed_at='2026-01-01',html_url='https://example.invalid/peer')]})
        for event in ('push','pull_request'):
            for job in jobs:
                for code in (0,7):
                    with self.subTest(event=event,job=job,code=code):
                        command=[sys.executable,'-c',
                            'import time;time.sleep(.05);print("own command completed");'
                            'print("FAIL test/own.test.ts > actual" if '+str(code)+' else "success");'
                            'raise SystemExit('+str(code)+')']
                        with patch.dict(os.environ,{'GITHUB_EVENT_NAME':event,'GITHUB_JOB':job,
                                'GITHUB_REPOSITORY':'fixture/project','GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1'}), \
                                patch.object(sys,'argv',['ci-fail-fast.py','--',*command]), \
                                patch.dict(main.__globals__,{'run':lambda args,*rest:run(args,*rest,record=False)}), \
                                patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,payload,'')) as observer, \
                                contextlib.redirect_stdout(io.StringIO()) as out, \
                                self.assertRaises(SystemExit) as stopped:
                            main()
                        self.assertEqual(stopped.exception.code,code)
                        observer.assert_not_called()
                        self.assertIn('own command completed',out.getvalue())
                        self.assertNotIn('Peer job',out.getvalue())
                        if code:
                            self.assertIn('::error file=test/own.test.ts',out.getvalue())
                        else:
                            self.assertNotIn('::error',out.getvalue())

    def test_interrupt_stops_owned_descendants_and_preserves_foreign_process(self):
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            marker=Path(directory).resolve()/'stopped'
            descendant='import signal,pathlib,sys;signal.signal(signal.SIGTERM,lambda *_:(pathlib.Path('+repr(str(marker))+').touch(),sys.exit(0)));print("owned ready",flush=True);signal.pause()'
            child='import subprocess,sys,signal;subprocess.Popen([sys.executable,"-c",'+repr(descendant)+']);signal.pause()'
            with subprocess.Popen([sys.executable,'-c','import signal;print("foreign ready",flush=True);signal.pause()'],
                    stdout=subprocess.PIPE,text=True) as foreign:
                wrapper=None
                try:
                    self.assertEqual(foreign.stdout.readline().strip(),'foreign ready')
                    wrapper=subprocess.Popen([sys.executable,'scripts/ci-fail-fast.py','--',sys.executable,'-c',child],
                        stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
                    self.assertEqual(wrapper.stdout.readline().strip(),'owned ready')
                    wrapper.terminate()
                    output=wrapper.communicate(timeout=3)[0]
                    self.assertEqual(wrapper.returncode,143,output)
                    self.assertTrue(marker.exists())
                    self.assertIsNone(foreign.poll())
                finally:
                    if wrapper is not None and wrapper.poll() is None:
                        wrapper.kill();wrapper.communicate(timeout=3)
                    foreign.terminate();foreign.wait(timeout=3)

    def test_combined_typecheck_keeps_complete_commands_and_drains_both(self):
        source=Path('.github/workflows/deploy.yml').read_text()
        types=source.split('\n  typecheck-lint:\n',1)[1].split('\n  prepare:\n',1)[0]
        self.assertNotIn('strategy:',types)
        self.assertNotIn('matrix.',types)
        self.assertNotIn('lint:fast',types)
        self.assertIn('python3 scripts/ci-products.py unpack',types)
        self.assertIn('python3 scripts/ci-fail-fast.py -- /usr/bin/time -v bash scripts/typecheck-lint.sh',types)
        command=Path('scripts/typecheck-lint.sh').read_text()
        self.assertIn('pnpm exec tsc -b tsconfig.layers.json --builders 1',command)
        self.assertIn('pnpm run lint:typed --threads=4',command)
        self.assertIn('wait "$typecheck_pid"',command)
        self.assertIn('wait "$typed_lint_pid"',command)

    def test_behaviour_matrix_keeps_independent_jobs_and_runs_every_case(self):
        source=Path('.github/workflows/deploy.yml').read_text()
        behaviour=source.split('\n  behaviour:\n',1)[1].split('\n  phone-route:\n',1)[0]
        matrix=re.search(r'^\s+shard: \[([\d, ]+)\]',behaviour,re.MULTILINE)
        self.assertIsNotNone(matrix)
        indexes=[int(value.strip()) for value in matrix.group(1).split(',')]
        self.assertEqual(indexes,list(range(1,len(indexes)+1)))
        self.assertIn('fail-fast: false',behaviour)
        self.assertNotIn('fail-fast: true',behaviour)
        self.assertIn('python3 scripts/ci-fail-fast.py -- python3 scripts/heavy-lane.py check -- pnpm exec vitest run --config scripts/vitest-ci.config.ts --shard=${{ matrix.shard }}/'+str(len(indexes))+' --bail=0',behaviour)

    def test_failure_record_contains_paths_not_log_text(self):
        function=API['diagnose']
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            root=Path(directory)
            with patch.dict(function.__globals__,{'Path':lambda value:root/value,'print_culprits':lambda files:None}),contextlib.redirect_stdout(io.StringIO()):
                function('FAIL test/actual.test.ts > private diagnostic',1)
            row=json.loads((root/'tmp/ci-failures/failure.json').read_text())
            self.assertEqual(row['files'],['test/actual.test.ts'])
            self.assertNotIn('private diagnostic',json.dumps(row))

    def test_culprit_output_is_bounded_and_observation_failure_does_not_hide_red(self):
        report=API['print_culprits']
        row={'base':'a'*40,'candidates':[{'sha':'b'*40,'match':'literal import','subject':'fix fixture',
            'assistedBy':'fixture:recorded'}],'missingImports':[]}
        with patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(row),'')), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            report(['test/actual.test.ts'])
        self.assertIn('Last green main push: '+'a'*40,out.getvalue())
        self.assertIn('Candidate '+'b'*40,out.getvalue())
        self.assertIn('Assisted-by: fixture%3Arecorded',out.getvalue())
        with patch.object(subprocess,'run',side_effect=subprocess.TimeoutExpired('node',35)), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            report(['test/actual.test.ts'])
        self.assertIn('original check remains red; no retry',out.getvalue())

    def test_helper_refusal_keeps_one_bounded_escaped_reason_not_arbitrary_stderr(self):
        report=API['print_culprits']
        detail='missing base, literal: '+('x'*300)
        failure='untrusted child output\nCI culprit report unavailable: '+detail+'\n::error::injected\n'
        with patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],1,'',failure)), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            report(['test/actual.test.ts'])
        message=out.getvalue()
        self.assertIn('helper exited 1; missing base%2C literal%3A ',message)
        self.assertIn('original check remains red; no retry',message)
        self.assertNotIn('untrusted child output',message)
        self.assertNotIn('injected',message)
        self.assertNotIn('Candidate ',message)
        self.assertEqual(len(message.splitlines()),1)
        self.assertLess(len(message),400)
        with patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],2,'','other failure')), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            report(['test/actual.test.ts'])
        self.assertIn('helper exited 2; original check remains red; no retry',out.getvalue())

    def test_only_own_push_failure_reports_its_culprits(self):
        function=API['diagnose'];calls=[]
        with tempfile.TemporaryDirectory(dir='tmp') as directory:
            root=Path(directory)
            with patch.dict(function.__globals__,{'Path':lambda value:root/value,'print_culprits':lambda files:calls.append(files)}), \
                    patch.dict(os.environ,{'GITHUB_EVENT_NAME':'push','GITHUB_RUN_ID':'42'}), \
                    contextlib.redirect_stdout(io.StringIO()):
                function('FAIL test/actual.test.ts > failure',7)
                with patch.dict(os.environ,{'GITHUB_EVENT_NAME':'pull_request'}):
                    function('FAIL test/other.test.ts > actual',7)
            self.assertEqual(calls,[['test/actual.test.ts']])


if __name__=='__main__':
    unittest.main()
