// @vitest-environment happy-dom
// The drop modal's one exception (Jake, 2026-11-12: "unless the user hits the button, like exit the main menu"): the pause
// menu's EXIT TO MAIN MENU clears the breadcrumb, so the title it reaches shows no modal.
import { expect, test } from 'vitest';
import { markDropStep, takeDrop } from '@wildshard/engine/boot/dropNotice';
import type { LastEnd } from '@wildshard/engine/boot/lastEnd';
import { exitSessionToTitle } from './exitToTitle';

const fresh: LastEnd = { kind: 'fresh', reason: 'fresh launch', at: 0, resident: '', slug: '', mode: '', build: '', bootedAt: 0, discarded: false, nav: 'navigate' };

test("the pause menu's exit to main menu leaves a quiet title", () => {
  markDropStep({ world: 'blender-template', name: 'Blender Template', step: 'Playing' });
  const went: string[] = [];
  exitSessionToTitle({ url: 'https://play.example/?chunk=blender-template', replace: (url) => { went.push(url); } });
  expect(went).toEqual(['https://play.example/']);
  expect(takeDrop(fresh)).toBeNull();
});

test('the same title without the exit, after a reload the game made, would show the drop', () => {
  markDropStep({ world: 'blender-template', name: 'Blender Template', step: 'Playing' });
  expect(takeDrop({ ...fresh, kind: 'intentional', reason: 'online seat in another grid cell (driftwood-isle)' }))
    .toMatchObject({ kind: 'restart', what: 'Unexpectedly back at the title', step: 'Playing' });
});
