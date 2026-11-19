import { expect, phoneTest as test } from './fixtures.ts'

import type { CDPSession, Page } from '@playwright/test'

// MEMORY-STRUCTURE STR31: every full-screen composited layer costs its whole backing (13 MB of GPU at a phone's device
// scale 3, meta engine-memory/gpu-staircase-2026-11-18.md); in play the only free one is the document's root, which a
// blank page has too. Chromium's layer tree in play may hold the root and the game canvas at full screen; the HUD adds
// none.

interface CdpLayer {
  readonly layerId: string
  readonly width: number
  readonly height: number
  readonly drawsContent: boolean
  readonly invisible?: boolean
  readonly backendNodeId?: number
}
interface Described {
  readonly node: {
    readonly nodeName: string
    readonly attributes?: readonly string[]
  }
}
interface Viewport {
  readonly width: number
  readonly height: number
}
/** Full-screen layers allowed in play: the document's root and the game canvas. */
const ALLOWED = /^(?:#document|html|body|canvas\b|anonymous)/u

async function nodeName(
  cdp: CDPSession,
  backendNodeId: number | undefined,
): Promise<string> {
  if (backendNodeId === undefined) {
    return 'anonymous'
  }
  const { node } = (await cdp.send('DOM.describeNode', {
    backendNodeId,
  })) as Described
  const attrs = node.attributes ?? []
  const attr = (name: string): string => {
    const at = attrs.indexOf(name)
    return at === -1 ? '' : (attrs[at + 1] ?? '')
  }
  const id = attr('id') === '' ? '' : `#${attr('id')}`
  const cls =
    attr('class') === '' ? '' : `.${attr('class').split(' ').join('.')}`
  return `${node.nodeName.toLowerCase()}${id}${cls}`
}

/** The nodes of Chromium's composited layers that draw content and cover 90% or more of each side of the viewport. */
async function fullScreenLayers(
  page: Page,
  view: Viewport,
): Promise<readonly string[]> {
  const cdp = await page.context().newCDPSession(page)
  const seen: { layers: readonly CdpLayer[] } = { layers: [] }
  try {
    cdp.on(
      'LayerTree.layerTreeDidChange',
      (event: { readonly layers?: readonly CdpLayer[] }): void => {
        const { layers } = event
        if (layers !== undefined) {
          seen.layers = layers
        }
      },
    )
    await cdp.send('DOM.getDocument', { depth: 0 })
    await cdp.send('LayerTree.enable')
    await expect.poll((): number => seen.layers.length).toBeGreaterThan(0)
    const full = seen.layers.filter(
      (layer): boolean =>
        layer.drawsContent &&
        layer.invisible !== true &&
        layer.width >= 0.9 * view.width &&
        layer.height >= 0.9 * view.height,
    )
    return await Promise.all(
      full.map(
        async (layer): Promise<string> =>
          await nodeName(cdp, layer.backendNodeId),
      ),
    )
  } finally {
    await cdp.detach()
  }
}

test('the phone composites no full-screen HUD layer in play', async ({
  page,
}): Promise<void> => {
  await page
    .locator('.ws-touch-attack')
    .waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(2500)
  const view = page.viewportSize()
  if (view === null) {
    throw new Error('No phone viewport')
  }
  const full = await fullScreenLayers(page, view)
  test.info().annotations.push({
    type: 'STR31 full-screen layers',
    description: JSON.stringify(full),
  })
  expect(full.filter((node): boolean => !ALLOWED.test(node))).toEqual([])
})
