/** Read only the engine's explicit scalar diagnostic port. Old probes and accessors are unavailable,
 * never zero; calling an arbitrary getter could rebuild a retired resource during a memory audit.
 * @param {unknown} api
 * @returns {unknown}
 */
export function readPageMemoryAttribution(api){
  if(api===null||typeof api!=='object')return null;
  const read=Object.getOwnPropertyDescriptor(api,'memory')?.value;
  return typeof read==='function'?/** @type {unknown} */(read.call(api)):null;
}

/** Self-contained expression for WebKit's evaluator; carries no resource references or engine imports. */
export const pageMemoryAttributionExpression=`(${readPageMemoryAttribution.toString()})(api)`;
