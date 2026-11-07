
const _animalXZ: { x: number; z: number }[] = [];
export function animalPositions(list: { position: { x: number; z: number }; alive?: boolean }[]): { x: number; z: number }[] {
  let n = 0;
  for (const a of list) { if (a.alive === false) continue; const p = _animalXZ[n] ??= { x: 0, z: 0 }; p.x = a.position.x; p.z = a.position.z; n++; }
  _animalXZ.length = n;
  return _animalXZ;
}
