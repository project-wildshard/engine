// oxlint-disable-next-line import/no-nodejs-modules -- Reads the checked-in workflow file.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Fix-preview PV13 (Jake, 2026-11-26: "preview deploy github action should not write to R2"): the hourly preview deploys
// its page to the preview Worker's static assets only. No content set, no R2 key, no signed releases/preview.json.
const workflow = readFileSync(new URL('../.github/workflows/preview.yml', import.meta.url), 'utf8');
const lines = workflow.split('\n').filter(line => !/^\s*#/u.test(line));

test('PV13: preview.yml passes no --content and holds no R2 key or R2 write', () => {
  const release = lines.filter(line => line.includes('node src/scripts/page-release.mjs'));
  expect(release).toHaveLength(1);
  expect(release[0]).toContain('page-release.mjs preview build,upload,check,go-live --host=workers');
  expect(release[0]).not.toContain('--content');
  for (const line of lines) {
    expect(line, line).not.toMatch(/\bR2_[A-Z_]+\b|wrangler\s+r2|\br2\s+object\b|aws\s+s3|releases\/preview\.json|page-release\/preview\.mjs/u);
  }
});
