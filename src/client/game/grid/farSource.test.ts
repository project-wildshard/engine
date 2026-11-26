// @vitest-environment node
// QA 11-25 row 133: `wildshard dev` boots a staging client whose inventory lists Nine's baked far, and serves the author's
// product, not that folder: the far fetch 404'd and the boot stopped at `gap`. The far source is decided by what the
// server serves: a listed baked far it answers 404 for is read from the product's own far rows.
import { expect, test } from 'vitest';
import { bakedFarServed, farSource } from './farSource';

/** A product whose far rows read only with `anyWorld` (no mesh collision, as Nine's), and a server answering `status`. */
function ports(status: number, rows: string | null = 'own far') {
  const asked: string[] = [];
  return { asked, ports: {
    product: (anyWorld: boolean) => { asked.push(`product ${String(anyWorld)}`); return Promise.resolve(anyWorld ? rows : null); },
    baked: () => { asked.push('baked'); return Promise.resolve(new Response(status === 200 ? '{}' : null, { status })); },
  } };
}

test('a listed baked far the server serves is read from the baked folder', async () => {
  const { asked, ports: p } = ports(200);
  const source = await farSource('served-slug', true, p);
  expect(source.kind).toBe('baked');
  expect(asked).toEqual(['product false', 'baked']);
  expect(bakedFarServed('served-slug', true)).toBe(true);
});

test('a listed baked far the server answers 404 for is read from the product, and the slug reads the product after', async () => {
  const first = ports(404);
  expect(await farSource('dev-slug', true, first.ports)).toEqual({ kind: 'product', far: 'own far' });
  expect(first.asked).toEqual(['product false', 'baked', 'product true']);
  expect(bakedFarServed('dev-slug', true), 'keepFarFiles reads the product too').toBe(false);
  const again = ports(404);
  expect(await farSource('dev-slug', true, again.ports)).toEqual({ kind: 'product', far: 'own far' });
  expect(again.asked, 'no second fetch of the missing file').toEqual(['product true']);
});

test('a 404 with no product far rows, a failed fetch, or an unlisted slug keep the baked answer for the caller to refuse', async () => {
  const none = ports(404, null);
  const missing = await farSource('bare-slug', true, none.ports);
  expect(missing.kind === 'baked' && missing.response.status).toBe(404);
  const failing = ports(503);
  const busy = await farSource('busy-slug', true, failing.ports);
  expect(busy.kind === 'baked' && busy.response.status, 'a server error is not a missing file').toBe(503);
  expect(failing.asked).toEqual(['product false', 'baked']);
  expect(bakedFarServed('busy-slug', true)).toBe(true);
  const unlisted = ports(404);
  expect(await farSource('upload-slug', false, unlisted.ports)).toEqual({ kind: 'product', far: 'own far' });
  expect(unlisted.asked).toEqual(['product true']);
});
