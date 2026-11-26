/** Deterministic game-frame barriers; wall time never decides the number of input steps.
 * @param {import('playwright').Page} page @param {number} frames */
export function advance(page,frames) { return page.evaluate((n)=>window.__parity.advance(n),frames); }
/** @param {import('playwright').Page} page @param {import('../types/wildshard-probe.d.ts').ProbePose} pose */
export async function poseAt(page,pose) {
  await page.evaluate((p)=>window.__wildshard.pose(p),pose);
  await advance(page,2);
}
