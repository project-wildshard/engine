// @vitest-environment happy-dom
// QA-FEEDBACK 11-19 row 25, J454 (Jake, Cinder Orchard on staging): "the completion card should not have exit the title ... it
// bumps you out of the MMO ... Just get rid of the exit the title button on the completion card." The zone completion card in
// every zone offers one way on: KEEP EXPLORING. No TITLE SCREEN, and no NEXT SHARD either (it leaves the world the same way).
import { afterEach, expect, test } from 'vitest';
import { installBrowserScopeEnvironment } from '@wildshard/engine/app/view/scopeEnvironment';
import { ShardComplete, shardCompleteUp } from './ShardComplete';

const data = { kicker: 'A first adventure · complete', title: 'Cinder Orchard', flavour: ['The orchard burns bright again.'], stats: [], todo: [] };
let card: ShardComplete | null = null;
afterEach(() => { card?.close(); card = null; });

test('the completion card offers only KEEP EXPLORING', () => {
  installBrowserScopeEnvironment();
  document.body.innerHTML = '<div id="hud"></div>';
  let kept = 0;
  card = new ShardComplete();
  card.open({ ...data }, { keep: () => { kept++; } });
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.ws-complete button')];
  expect(buttons.map(button => button.dataset['act'])).toEqual(['keep']);
  expect(buttons.map(button => button.textContent.trim())).toEqual(['Keep exploring▸']);
  expect(document.querySelector('.ws-complete')?.textContent).not.toMatch(/title screen|next shard/iu);
  buttons[0]?.click();
  expect(kept).toBe(1);
  expect(shardCompleteUp()).toBe(true);
});
