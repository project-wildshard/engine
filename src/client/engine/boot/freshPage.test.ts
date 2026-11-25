// Meta IPHONE13-DRIFTWOOD DW12: the game's own navigations leave through the leave page, whose script sends them on.
// oxlint-disable-next-line import/no-nodejs-modules -- Run the leave page's own inline script against a stand-in location.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { LEAVE_PAGE, LEAVE_PATH as HOST_LEAVE_PATH } from '../../../../scripts/app-build/isolation.mjs';
import { LEAVE_PATH, throughLeave } from './freshPage';

const ORIGIN = 'https://staging.wildshard.io';

/** Run the leave page's script at `href` and say where it goes. */
function leaveTo(href: string): string {
  const script = /<script>(?<code>[\s\S]*)<\/script>/u.exec(LEAVE_PAGE)?.groups?.['code'] ?? '';
  const at = new URL(href);
  let went = '';
  const location = { origin: at.origin, search: at.search, replace: (to: string) => { went = to; } };
  const frames: (() => void)[] = [];
  runInNewContext(script, { location, URL, URLSearchParams,
    requestAnimationFrame: (draw: () => void) => frames.push(draw), setTimeout: () => 0 });
  expect(went).toBe('');
  frames.shift()?.();
  expect(went).toBe('');
  frames.shift()?.();
  return went;
}

test('the leave address keeps the path, query and hash, and the leave page goes there', () => {
  expect(LEAVE_PATH).toBe(HOST_LEAVE_PATH);
  for (const target of ['/slug/driftwood-isle', '/?at=1,2&glreload#x', '/slug/sky-reach?tier=3']) {
    const leave = throughLeave(target, ORIGIN);
    expect(leave.startsWith('/leave?to=')).toBe(true);
    expect(leaveTo(new URL(leave, ORIGIN).href)).toBe(target);
  }
  expect(throughLeave(`${ORIGIN}/slug/driftwood-isle`, ORIGIN)).toBe('/leave?to=%2Fslug%2Fdriftwood-isle');
});

test('another origin is not sent through the leave page, and the leave page sends nowhere but this origin', () => {
  expect(throughLeave('https://example.com/x', ORIGIN)).toBe('https://example.com/x');
  for (const to of ['https://example.com/x', '//example.com/x', '/leave?to=%2F', ['java', 'script:alert(1)'].join('')]) {
    expect(leaveTo(`${ORIGIN}/leave?to=${encodeURIComponent(to)}`), to).toBe('/');
  }
  expect(leaveTo(`${ORIGIN}/leave`)).toBe('/');
});
