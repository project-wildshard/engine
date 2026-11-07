// oxlint-disable-next-line import/no-nodejs-modules -- Run only owned offline controller fixtures, never a deployment.
import {spawnSync} from 'node:child_process';
import {expect,test} from 'vitest';
import deploy from '../.github/workflows/deploy.yml?raw';
import {matchesDeployment} from '../scripts/deploy-version.mjs';

test('the protected staging native fixtures refuse foreign, partial, public and red-wave paths',()=>{
  const result=spawnSync('python3',['scripts/test_staged_deployment.py'],{
    encoding:'utf8',timeout:10_000,env:{...process.env,STAGE_HELPER:process.env['STAGED_HELPER'] ?? 'scripts/staged-deployment.py'},
  });
  expect(result.error).toBeUndefined();
  expect(result.status,result.stdout+result.stderr).toBe(0);
});

test('the optional stage runs beside the unchanged source wave and never owns promotion',()=>{
  const stage=deploy.split('\n  stage-prebuilt:\n')[1]?.split('\n  build-and-deploy:\n')[0];
  const ship=deploy.split('\n  build-and-deploy:\n')[1]?.split('\n  typecheck-lint:\n')[0];
  if(stage===undefined||ship===undefined)throw new Error('Missing actual stage or publisher');
  expect(stage).toContain('    needs: prepare\n');
  expect(stage).toContain("github.event_name == 'push' && needs.prepare.result == 'success'");
  expect(stage).toContain('    continue-on-error: true');
  expect(stage).not.toContain(' promote ');
  expect(stage).toContain(`receipt: \${{ steps.complete.outputs.receipt }}`);
  expect(stage.indexOf('id: complete')).toBeGreaterThan(stage.indexOf('id: maps'));
  expect(stage).toContain(`MAP_ARTIFACT_ID: \${{ steps.maps.outputs.artifact-id }}`);
  expect(stage).toContain(`MAP_ARTIFACT_DIGEST: \${{ steps.maps.outputs.artifact-digest }}`);
  expect(ship).toContain('needs: [prepare, typecheck-lint, behaviour, native-escape, journeys, stage-prebuilt]');
  const release=/^ {6}RELEASE_ALLOWED: (.+)$/mu.exec(ship)?.[1];
  if(release===undefined)throw new Error('Missing unchanged required source admission');
  expect(release).not.toContain('stage-prebuilt');
  for(const gate of ['prepare','typecheck-lint','behaviour','native-escape','journeys'])
    expect(release).toContain(`needs.${gate}.result == 'success'`);
  expect(ship).toContain('check-live-floor "$DEPLOY_SHA"');
  const selection=ship.split('- name: Select the optional protected production stage')[1]?.split('- name: Install the pinned promotion CLI')[0];
  expect(selection).toContain("needs.stage-prebuilt.result == 'success'");
  expect(selection).toContain(`STAGE_RESULT: \${{ needs.stage-prebuilt.result }}`);
});

test('failed staging retains original strict fallback, private maps and final production authority',()=>{
  const ship=deploy.split('\n  build-and-deploy:\n')[1]?.split('\n  typecheck-lint:\n')[0];
  if(ship===undefined)throw new Error('Missing actual publisher');
  const restore=ship.split('- name: Restore the exact successful push artifact')[1]?.split('# Explicit recovery')[0];
  const maps=ship.split('- name: Retain production source maps privately')[1]?.split('- name: Deploy prebuilt output')[0];
  const publish=ship.split('- name: Deploy prebuilt output')[1]?.split('- name: Verify production')[0];
  if(restore===undefined||maps===undefined||publish===undefined)throw new Error('Missing original fallback boundaries');
  expect(restore).toContain("steps.staged.outputs.promote != 'true'");
  expect(restore).toContain('staged-deployment.py" restore-install');
  expect(maps).toContain("steps.staged.outputs.promote != 'true'");
  expect(maps).toContain('overwrite: true');
  expect(maps).toContain('if-no-files-found: error');
  expect(publish).toContain('staged-deployment.py" promote');
  expect(publish).toContain('vercel deploy --prebuilt --prod');
  expect(publish.indexOf('check-live-floor')).toBeLessThan(publish.indexOf('staged-deployment.py" promote'));
  expect(publish.indexOf('deploy-source-maps.mjs')).toBeLessThan(publish.indexOf('vercel deploy --prebuilt'));
  expect(ship).toContain('node "$RUNNER_TEMP/deploy-version.mjs" verify');
  expect(ship).toContain(`DEPLOY_EXPECTED_BUILD: \${{ steps.staged.outputs.build }}`);
  expect(ship).toContain("'x-review-password: invalid'");
  expect(ship).toContain('context=production-live');
});

test('the same original version response must match the exact staged BUILD and source',()=>{
  const sha='a'.repeat(40);
  expect(matchesDeployment('aaaaaaa-exact',sha,'aaaaaaa-exact')).toBe(true);
  expect(matchesDeployment('aaaaaaa-different',sha,'aaaaaaa-exact')).toBe(false);
  expect(matchesDeployment('bbbbbbb-exact',sha,'bbbbbbb-exact')).toBe(false);
  expect(matchesDeployment('aaaaaaa-historical',sha,undefined)).toBe(true);
  expect(matchesDeployment(undefined,sha,undefined)).toBe(false);
});
