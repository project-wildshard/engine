import './format-hook.mjs';

const { CHUNK_HALF } = await import('@wildshard/format/contentBounds');

/** G872 (wildshard-new, 2026-11-04): list optional radial metadata outside
 * its cell, with an already drawn near view, separately. World/required/unknown
 * work remains blocking; settled crossing alone never proves request ownership.
 * @param {import('./frame-floor-pending.mjs').FloorPendingContext} context */
export function frameFloorPending(context) {
  const world = [], optionalMetadata = [];
  const pending = new Set([...context.pending, ...(context.pendingWork?.map(row => row.instance) ?? [])]);
  for (const instance of pending) {
    const work = context.pendingWork?.filter(row => row.instance === instance) ?? [];
    const cells = context.cells.filter(row => row.instance === instance);
    const cell = cells.length === 1 ? cells[0] : undefined;
    const feet = context.worldFeet, pitch = context.pitch;
    const distance = cell === undefined || feet === undefined || pitch === undefined
      || ![feet.x, feet.z, pitch, ...cell.cell].every(Number.isFinite) || pitch <= 0
      ? null : Math.hypot(Math.max(0, Math.abs(feet.x - cell.cell[0] * pitch) - CHUNK_HALF),
        Math.max(0, Math.abs(feet.z - cell.cell[1] * pitch) - CHUNK_HALF));
    if (context.pending.includes(instance) && work.length === 1 && work[0]?.kind === 'optional-metadata' && work[0].trigger === 'radial'
      && context.current !== instance && !context.residents.includes(instance)
      && context.gameplayReady === true && context.crossing === 'settled'
      && distance !== null && distance > 0 && cell?.shows === 'near' && cell.drawn?.near === true) {
      optionalMetadata.push({ instance, kind: 'optional-metadata', trigger: 'radial', outsideMetres: distance });
    } else world.push(instance);
  }
  return { pendingWorld: world, pendingOptionalMetadata: optionalMetadata };
}
