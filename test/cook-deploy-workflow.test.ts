// oxlint-disable-next-line import/no-nodejs-modules -- This test reads the workflow as written.
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';

/** C3, J29: heads go on a build at release, so the release has to hold the cook's source, ship the bytes it baked, and leave
 *  the unset variable inert. */
const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
const job = (name: string): string => new RegExp(String.raw`\n {2}${name}:\n[\s\S]*?(?=\n {2}[a-z][a-z0-9-]*:\n)`, 'u').exec(deploy)?.[0] ?? '';
const stepsFrom = (text: string): string[] => text.split(/\n {6}- /u).slice(1);
const ship = job('build-and-deploy'), steps = stepsFrom(ship), at = (name: string): number => steps.findIndex(step => step.includes(`name: ${name}`));

test('a catalogue deploy never promotes a stage: a staged copy can\'t hold what goes on at release', () => {
  expect(steps[at('Select the optional protected production stage')]).toContain("vars.WILDSHARD_API_URL == ''");
});

test('the cook runs from the pin\'s source, onto the output that ships', () => {
  const checkout = at('Check out the cook at the pin'), cook = at('Cook the catalogue\'s heads for this build');
  expect(at('Restore the exact successful push artifact')).toBeLessThan(checkout);
  expect(checkout).toBeLessThan(cook);
  expect(cook).toBeLessThan(at('Deploy prebuilt output'));
  expect(steps[checkout]).toContain('steps.pin.outputs.sha');
  expect(steps[cook]).toContain('working-directory: cook-source');
  expect(steps[cook]).toContain('pnpm install --frozen-lockfile');
  expect(steps[cook]).toContain('cook-worker.mjs bake ../.vercel/output/static');
});

test('every cook step stays off with the variable unset, and on a promotion', () => {
  const rows = steps.slice(at('Check out the cook at the pin'), at('Cook the catalogue\'s heads for this build') + 1);
  expect(rows).toHaveLength(5);
  for (const step of rows) {
    expect(step).toContain("vars.WILDSHARD_API_URL != ''");
    expect(step).toContain("steps.staged.outputs.promote != 'true'");
  }
});
