import { expect, test } from 'vitest';
import { plainEntry } from './workerTiming';

// OFF-VERCEL OV6: on the Cloudflare edge every response carries Server-Timing, and Chromium's resource entry toJSON()
// keeps those rows as PerformanceServerTiming objects, which postMessage can't clone.
class ServerTiming {
  readonly name = 'cfEdge';
  readonly duration = 3;
  readonly description = '';
  readonly clone = (): undefined => undefined;
  toJSON(): object { return { name: this.name, duration: this.duration, description: this.description }; }
}

test('a resource entry with Server-Timing rows posts as plain, cloneable data', () => {
  const row = { name: 'https://preview.wildshard.io/version.json', serverTiming: [new ServerTiming()] };
  const entry = { toJSON: (): object => row };
  expect(() => structuredClone(entry.toJSON())).toThrow();
  expect(structuredClone(plainEntry(entry))).toEqual({ name: row.name, serverTiming: [{ name: 'cfEdge', duration: 3, description: '' }] });
});
