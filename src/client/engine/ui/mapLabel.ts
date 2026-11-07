/** Fit complete words inside one map label's pixel box; no line can reach a neighbour. */
export function fitMapLabel(text: string, width: number, height: number, preferred: number, minimum: number,
  measure: (line: string, font: number) => number): { readonly lines: readonly string[]; readonly font: number } {
  if (![width, height, preferred, minimum].every(Number.isFinite) || width <= 0 || height <= 0 || minimum <= 0) return { lines: [], font: minimum };
  const words = text.trim().split(/\s+/u);
  for (let font = Math.max(minimum, preferred); font >= minimum; font--) {
    const lines: string[] = []; let line = '', fits = true;
    for (const word of words) {
      if (measure(word, font) > width) { fits = false; break; }
      const next = line.length === 0 ? word : `${line} ${word}`;
      if (measure(next, font) <= width) line = next;
      else { lines.push(line); line = word; }
    }
    if (line.length > 0) lines.push(line);
    if (fits && lines.length * font * 1.15 <= height) return { lines, font };
  }
  return { lines: [], font: minimum };
}
