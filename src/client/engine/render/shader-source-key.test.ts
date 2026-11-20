import { expect, test } from 'vitest';
import { sha256 } from '../../../shared/engine/core/sha256';
import { sourceKey } from './shaderSourceCache';

// Meta IPHONE13-DRIFTWOOD DW7 (mini-dw-boot, 2026-11-20): the shader source book's key is a 64-bit multiply-xor key, not a
// JS SHA-256 (183 of 2050 profiler samples in Driftwood's home step on the iPhone 13).

const graph = JSON.stringify(Array.from({ length: 1500 }, (_, i) => ({ op: 'mul', a: i, b: `n${String(i * 7)}`, t: 'vec3' })));

test('a source key is stable, carries the length, and moves with any one unit', () => {
  expect(sourceKey(graph)).toBe(sourceKey(graph.slice(0)));
  expect(sourceKey(graph)).toMatch(/^[0-9a-f]{16}\.[0-9a-z]+$/u);
  expect(sourceKey('')).not.toBe(sourceKey(' '));
  const flipped = `${graph.slice(0, 900)}${graph[900] === '1' ? '2' : '1'}${graph.slice(901)}`;
  expect(sourceKey(flipped)).not.toBe(sourceKey(graph));
  expect(sourceKey('ab')).not.toBe(sourceKey('ba'));
  expect(sourceKey('é')).not.toBe(sourceKey('e'));
});

test('two hundred thousand near-identical sources get distinct keys', () => {
  const keys = new Set<string>();
  for (let i = 0; i < 200_000; i++) keys.add(sourceKey(`material ${String(i)} ${graph.slice(0, i % 500)}`));
  expect(keys.size).toBe(200_000);
});

test.runIf(process.env['WS_BENCH'] === '1')('the key is at least twice as cheap as SHA-256 of the UTF-8 bytes', () => {
  const encoder = new TextEncoder();
  const time = (fn: () => string): number => {
    for (let i = 0; i < 20; i++) fn();
    const start = performance.now();
    for (let i = 0; i < 200; i++) fn();
    return (performance.now() - start) / 200;
  };
  const slow = time(() => sha256(encoder.encode(graph))), fast = time(() => sourceKey(graph));
  console.info(`sha256 ${slow.toFixed(3)} ms, sourceKey ${fast.toFixed(3)} ms over ${String(graph.length)} units`);
  expect(fast * 2).toBeLessThan(slow);
});
