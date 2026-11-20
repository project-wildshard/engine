import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hourlyText } from '../metrics-hourly.mjs';

void test('the hourly report prints page totals, both UA tables and the offending lane', () => {
  const text = hourlyText({
    summary: { channels: [{ channel: 'staging', current: { live: { humans: 2, agents: 3 }, popular: ['nine-dragon-stack'] },
      rows: [{ day: '2026-11-19', metric: 'dau', actor: 'human', lane: '', slug: '', value: 5 }] }] },
    channels: [
      { channel: 'staging', markers: { seats: 50, leaks: 1, lanes: { 'missing-webkit': 1 } }, requests: [
        { count: 12, dimensions: { userAgent: 'node' } },
        { count: 4, dimensions: { userAgent: 'HeadlessChrome WildshardAgent/1 (phone)' } },
      ] },
      { channel: 'production', markers: { seats: 100, leaks: 1, lanes: { 'exact-boundary': 1 } }, requests: [] },
    ],
  });
  assert.match(text, /staging\t2\t3\t5\t—\tnine-dragon-stack/u);
  assert.match(text, /node\tmissing\t—\t12/u);
  assert.match(text, /HeadlessChrome\tmarked\tphone\t4/u);
  assert.match(text, /Marker leak over 1%: missing-webkit \(1\)/u);
  assert.doesNotMatch(text, /exact-boundary/u);
  assert.match(text, /Cloudflare last hour \(production\)/u);
});
