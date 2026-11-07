/**
 * The GL a precompile fixture's renderer hands its warm-up's link check (`reportLinkFailure`, D176): every program
 * linked. A fixture built on `WebGLRenderer.prototype` has no instance `getContext`; give it this one.
 */
export function linkedGl(): Pick<WebGL2RenderingContext, 'LINK_STATUS' | 'getProgramParameter'> {
  return { LINK_STATUS: 0x8b82, getProgramParameter: (): boolean => true };
}
