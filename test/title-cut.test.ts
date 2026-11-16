// STAGING-BUGBASH SB18 (J385: no other screen, overlay or cross-fade): after the Name prompt's SKIP, the main menu stayed on top of
// SHARD SELECT for 300 ms. `.ws-main` (above the deck) faded out over 0.3 s while the deck faded in under it, so a phone saw
// the main menu again between the prompt and the deck. Main menu and SHARD SELECT switch in one frame, both ways.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync(new URL('../src/client/game/mainMenu.css', import.meta.url), 'utf8');
/** the declarations of the first rule whose selector is exactly `selector` */
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  if (at === -1) throw new Error(`no ${selector} rule`);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

test('SB18: the main menu and SHARD SELECT cut, never cross-fade', () => {
  expect(rule('.ws-main')).not.toMatch(/transition\s*:\s*opacity/u);
  expect(rule('.ws-title-stack > .ws-menu')).toMatch(/transition\s*:\s*none/u);
});
