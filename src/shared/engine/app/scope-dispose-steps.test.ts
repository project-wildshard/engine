import { expect, test } from 'vitest';
import { Scope } from './scope';

/** A scope tree whose cleanups log their names: a parent with an early and a late cleanup around one child scope. */
function tree(log: string[]): { root: Scope; child: Scope } {
  const root = new Scope('root');
  root.onDispose(() => { log.push('root:first'); });
  const child = root.child('child');
  child.onDispose(() => { log.push('child:a'); });
  child.onDispose(() => { log.push('child:b'); });
  root.onDispose(() => { log.push('root:last'); });
  return { root, child };
}

test('O20 disposeSteps runs dispose()\'s cleanups in the same order, one step each', () => {
  const sync: string[] = [], stepped: string[] = [];
  tree(sync).root.dispose();
  const { root, child } = tree(stepped);
  const steps = [...root.disposeSteps()];
  expect(stepped).toEqual(sync);
  expect(steps.map(step => step.scope)).toEqual(['root', 'child', 'child', 'root']);
  expect(root.disposed && child.disposed).toBe(true);
});

test('O20 a stepped retirement closes at once and reports disposing across its yields', () => {
  const log: string[] = [], { root, child } = tree(log);
  const steps = root.disposeSteps();
  steps.next();
  expect(root.disposed).toBe(true);
  expect(log).toEqual(['root:last']);
  // between steps (other frames run here) the whole tree is one teardown: lookups are not new uses
  expect(child.disposing && root.disposing).toBe(true);
  expect(child.sharesTeardown(root) && root.sharesTeardown(child)).toBe(true);
  root.dispose(); // a closed scope's dispose adds nothing: the caller drains
  expect(log).toEqual(['root:last']);
  for (let step = steps.next(); step.done !== true; step = steps.next()) { /* drained */ }
  expect(log).toEqual(['root:last', 'child:b', 'child:a', 'root:first']);
  expect(child.disposing || root.disposing).toBe(false);
});

test('O20 disposeSteps still runs every cleanup when one throws, then throws them together', () => {
  const log: string[] = [], root = new Scope('root');
  root.onDispose(() => { log.push('after'); });
  root.onDispose(() => { throw new Error('boom'); });
  expect(() => { for (const step of root.disposeSteps()) void step; }).toThrow(/root disposal failed: boom/u);
  expect(log).toEqual(['after']);
});

test('O20 a cleanup in parts runs whole in dispose() and part by part in disposeSteps()', () => {
  const parts = (log: string[]) => function* abc(): Generator<undefined, void> { for (const part of ['a', 'b', 'c']) { log.push(part); yield; } };
  const whole: string[] = [], root = new Scope('root');
  root.onDisposeSteps(parts(whole));
  root.dispose();
  expect(whole).toEqual(['a', 'b', 'c']);
  const stepped: string[] = [], other = new Scope('other');
  other.onDisposeSteps(parts(stepped));
  const steps = other.disposeSteps();
  steps.next();
  expect(stepped).toEqual(['a']);
  expect(other.disposing).toBe(true);
  for (let step = steps.next(); step.done !== true; step = steps.next()) { /* drained */ }
  expect(stepped).toEqual(['a', 'b', 'c']);
});

test('G598 a captured scope another owner parents ends whole on dispose() and in steps when its owner retires in steps', () => {
  const run = (sliced: boolean): { log: string[]; steps: string[] } => {
    const log: string[] = [], parent = new Scope('parent'), owner = new Scope('owner'), piece = parent.child('piece');
    piece.onDispose(() => { log.push('piece:a'); }); piece.onDispose(() => { log.push('piece:b'); });
    owner.onDispose(() => { log.push('owner:first'); });
    const forget = owner.captureScope(piece);
    piece.onDispose(forget);
    const steps = sliced ? [...owner.disposeSteps()].map(step => step.scope) : (owner.dispose(), []);
    expect(piece.disposed).toBe(true);
    parent.dispose();
    return { log, steps };
  };
  const whole = run(false), stepped = run(true);
  expect(stepped.log).toEqual(whole.log);
  expect(stepped.steps).toEqual(['piece', 'piece', 'piece', 'owner']);
  // a captured scope that ends first leaves its owner nothing to end
  const owner = new Scope('owner'), piece = new Scope('piece'), log: string[] = [];
  piece.onDispose(() => { log.push('piece'); });
  piece.onDispose(owner.captureScope(piece));
  piece.dispose(); owner.dispose();
  expect(log).toEqual(['piece']);
});
