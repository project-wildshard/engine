// Meta EXPLORE-MODE EX9: explore-release.yml releases the Explore Worker in page-release's order. Its go-live moves
// explore.wildshard.io, so it must come after the check that the uploaded version's bytes equal the local build, and after
// the custom domain is attached. A reordered workflow fails here before it can publish an unchecked page.
// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the workflow file it guards.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const workflow = readFileSync('.github/workflows/explore-release.yml', 'utf8');

/** The release actions, in the order the workflow's `run:` lines name them. */
function releaseOrder(text: string): string[] {
  const order: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const phases = /page-release\.mjs explore ([a-z,-]+)/u.exec(line)?.[1];
    if (phases !== undefined) order.push(...phases.split(','));
    if (/wrangler triggers deploy .*--env explore/u.test(line)) order.push('triggers');
  }
  return order;
}

/** Why an order is unsafe, or null: every phase once, build, upload and check first, go-live last. */
function orderRefusal(order: readonly string[]): string | null {
  const at = (step: string): number => order.indexOf(step);
  for (const step of ['build', 'upload', 'check', 'triggers', 'go-live']) {
    if (order.filter((s) => s === step).length !== 1) return `${step} runs ${order.filter((s) => s === step).length} times`;
  }
  if (!(at('build') < at('upload') && at('upload') < at('check'))) return 'build, upload and check out of order';
  if (at('go-live') < at('check')) return 'go-live runs before check';
  if (at('go-live') < at('triggers')) return 'go-live runs before the domain is attached';
  return null;
}

test('explore-release goes live only after check and the domain', () => {
  expect(releaseOrder(workflow)).toEqual(['build', 'upload', 'check', 'triggers', 'go-live']);
  expect(orderRefusal(releaseOrder(workflow))).toBeNull();
});

test('a workflow that goes live before check is refused', () => {
  const early = workflow.replace('explore build,upload,check', 'explore build,upload,go-live').replace('explore go-live --content', 'explore check --content');
  expect(orderRefusal(releaseOrder(early))).toBe('go-live runs before check');
  expect(orderRefusal(['build', 'upload', 'check', 'go-live', 'triggers'])).toBe('go-live runs before the domain is attached');
});

test('the Cloudflare token reaches the steps only from the secret, never argv', () => {
  expect(workflow).not.toMatch(/--token|--api-token|CLOUDFLARE_API_TOKEN=/u);
  const tokens = workflow.match(/CLOUDFLARE_API_TOKEN: .*/gu) ?? [];
  expect(tokens.length).toBe(3);
  for (const line of tokens) expect(line).toBe('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
});
