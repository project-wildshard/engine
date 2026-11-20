// QA 11-19 row 19: the page-loaded Web Analytics beacon (src/client/engine/telemetry/analyticsBeacon.ts) is armed by the page
// entry itself. A launch that stays on the title never runs start(), so a beacon armed there never fired (staging v0.1.57).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('the page entry arms the beacon itself, not only from start(), which a plain title boot never runs', () => {
  // v0.1.57 on staging: index.html loads entry.ts, and entry.ts imports main.ts (whose module runs start()) only on the way
  // to a world, so a launch that stays on the title never armed the beacon and sent no page view with the zone's off
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const entry = readFileSync(resolve(process.cwd(), 'src/client/app/entry.ts'), 'utf8');
  expect(html).toContain('<script type="module" src="/src/client/app/entry.ts"></script>');
  expect(html).not.toContain('src/client/app/main.ts');
  const startAt = entry.indexOf('export function start(): Promise<void> {');
  const startBody = entry.slice(startAt, entry.indexOf('\n}\n', startAt));
  expect(startAt).toBeGreaterThan(-1);
  expect(startBody).not.toContain('analyticsBeacon');
  expect(entry.slice(0, startAt)).toMatch(/^armAnalyticsBeacon\(entryScope\);$/mu);
});
