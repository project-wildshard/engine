/** nalati-boot-check's benign network-error filter.
 * @param {string} message */
export function relevantError(message) {return !message.includes('favicon') && !message.includes('net::ERR_ABORTED');}
/** @param {import('playwright').Browser} browser @param {string} angle */
export async function assertMetal(browser,angle) {
  const page=await browser.newPage();
  try {const renderer=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');if(!gl)return 'no WebGL2';const e=gl.getExtension('WEBGL_debug_renderer_info');return e?String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)):'renderer unavailable';});if(!renderer.includes('ANGLE (Apple, ANGLE Metal Renderer'))throw new Error(`infrastructure: --angle=${angle}: ${renderer}`);return renderer;}finally{await page.close();}
}
