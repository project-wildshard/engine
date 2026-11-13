import { afterEach, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- the guard reads the client's own source files
import { readdirSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the guard walks the client's source tree
import { join } from 'node:path';
import { Player, touchPlay } from '../src/client/engine/player/Player';

/** a page whose touch layer is (or is not) mounted, on a coarse (or fine) primary pointer */
const g = globalThis as { document?: unknown; matchMedia?: unknown };
const page = (hudTouch: boolean, coarse: boolean): void => {
  g.document = { getElementById: (id: string) => (id === 'hud' ? { classList: { contains: (c: string) => c === 'touch' && hudTouch } } : null) };
  g.matchMedia = (q: string) => ({ matches: q === '(pointer: coarse)' && coarse });
};
const lockAsks = (): number => {
  let asked = 0;
  const canvas = { requestPointerLock: () => { asked++; return Promise.resolve(); } };
  Player.prototype.lock.call({ canvas } as unknown as Player);
  return asked;
};

afterEach(() => { delete g.document; delete g.matchMedia; }); // test/setup.ts's own stubs (localStorage, location) stay

test('touch play never asks for pointer lock (QA-FEEDBACK-2026-11-13 row 6, Chrome 145 on Android)', () => {
  page(true, true); expect(touchPlay()).toBe(true); expect(lockAsks()).toBe(0);
  page(true, false); expect(touchPlay()).toBe(true); expect(lockAsks()).toBe(0); // ?touch on a desktop
  page(false, true); expect(touchPlay()).toBe(true); expect(lockAsks()).toBe(0); // before the touch layer mounts
});

test('a mouse still locks the pointer on ENTER WORLD and a canvas click', () => {
  page(false, false); expect(touchPlay()).toBe(false); expect(lockAsks()).toBe(1);
});

test('every client pointer lock goes through Player.lock or a mouse-only path', () => {
  const allowed = [join('player', 'Player.ts'), join('explore', 'FreeCam.ts')]; // FreeCam returns on a touch pointerdown first
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.ts$/u.test(entry.name) && !entry.name.endsWith('.test.ts') && !allowed.some((a) => path.endsWith(a))
        && /\.requestPointerLock\(/u.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };
  walk(join(process.cwd(), 'src/client'));
  expect(offenders).toEqual([]);
});
