const unselected = (index: number): boolean => index === -1;

/** Publish every owner's shell level in the original roster order, including clearing old selections. */
export function publishShellLevels(animals: readonly { setShellLevel: (level: number) => void }[], indices: Int32Array, distances: Float64Array, count: number): void {
  if (indices.every(unselected)) {
    for (let i = 0; i < count; i++) animals[i]?.setShellLevel(0);
    return;
  }
  for (let i = 0; i < count; i++) {
    let level = 0;
    for (let k = 0; k < indices.length; k++) if (indices[k] === i) { const d = Math.sqrt(distances[k] ?? Infinity); level = d < 6 ? 8 : d < 11 ? 6 : 4; }
    animals[i]?.setShellLevel(level);
  }
}
