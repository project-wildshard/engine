import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Mandatory real-GC child verifies the retained touch layer.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only the bounded child configuration under tmp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the child runner without a shell.
import { resolve as resolvePath } from 'node:path';
import { Scope } from '../../../shared/engine/app/scope';
import { installBrowserScopeEnvironment } from '../app/view/scopeEnvironment';
import { TouchControls } from './TouchControls';
import type { Action, TouchVerbSpec } from '../input/InputService';

type Slot = 'verb.1' | 'verb.2';
function fixture() {
  installBrowserScopeEnvironment();
  const scope = new Scope('live touch layer'), root = document.createElement('div');
  const layer = { scope, verbs: new Map<string, HTMLButtonElement>(),
    verbActions: {} as Partial<Record<Slot, Action>>,
    heldVerbs: new Map<string, Action>(), verbSpecs: {} as Partial<Record<Slot, TouchVerbSpec>>,
    verbMarkup: {} };
  const method: unknown = Reflect.get(TouchControls.prototype, 'paintVerbs');
  if (typeof method !== 'function') throw new Error('Missing actual touch painter');
  return { layer, root, scope, paint: (verbs: Partial<Record<Slot, TouchVerbSpec>>) => { Reflect.apply(method, layer, [root, verbs]); } };
}
function retiredVerb(f: ReturnType<typeof fixture>, hidden: boolean): WeakRef<Scope> {
  const owner = new Scope('retired regional verb'), weak = new WeakRef(owner);
  f.paint({ 'verb.1': { action: 'use', icon: '', label: 'Use', hold: true, show: () => !owner.disposed } });
  expect(f.layer.verbs.get('verb.1')?.style.display).toBe('');
  owner.dispose();
  if (hidden) f.paint(f.layer.verbSpecs); else f.paint({});
  return weak;
}

test('hidden and absent slots drop retired regional verbs while the touch layer stays live', async () => {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    if (process.env['WS_TOUCH_VERB_GC'] === '1') throw new Error('Touch lifetime proof requires --expose-gc');
    mkdirSync('tmp', { recursive: true }); const directory = mkdtempSync(resolvePath('tmp/touch-verb-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['src/client/engine/player/touch-verb-lifetime.test.ts'],environment:'happy-dom',setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolvePath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
        env: { ...process.env, WS_TOUCH_VERB_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
      }); expect(output).toContain('1 passed');
    } finally { rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  for (const hidden of [false, true]) {
    const f = fixture(), weak = retiredVerb(f, hidden);
    try {
      for (let turn = 0; turn < 40; turn++) {
        await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
        if (weak.deref() === undefined) break;
      }
      expect(weak.deref()).toBeUndefined();
      expect(f.scope.disposed).toBe(false);
      expect(f.layer.verbs.get('verb.1')?.style.display).toBe('none');
      expect(f.layer.verbActions['verb.1']).toBeUndefined();
      expect(f.layer.verbSpecs['verb.1']).toBeUndefined();
      // Keep the same page layer, button and listeners live after collection.
      f.paint({ 'verb.1': { action: 'use', icon: '', label: 'Next', hold: false } });
      expect(f.layer.verbs.get('verb.1')?.style.display).toBe('');
      expect(f.layer.verbActions['verb.1']).toBe('use');
    } finally { f.scope.dispose(); }
  }
});
