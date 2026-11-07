/** Immutable V8 function provenance; unknown origins require a conservative
 * source-read fallback. Current source bytes must still be validated. */
export function functionSource(target:object):string|undefined;
