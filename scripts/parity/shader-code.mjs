/** Native program caches can choose the name of either identical material.
 * Ignore only an unused diagnostic macro; every executable byte stays exact.
 * @param {readonly string[]} sources */
export function shaderCodeSources(sources) {
  return sources.map(source => {
    const label = /^#define SHADER_NAME [^\r\n]*$/mu.exec(source);
    if (label === null || [...source.matchAll(/\bSHADER_NAME\b/gu)].length !== 1) return source;
    return source.replace(label[0], '#define SHADER_NAME parity_unreferenced_label');
  }).sort();
}
