import { createHash } from 'node:crypto';

const PART_MIN = 1.5 * (1 << 20), PART_MAX = 4 << 20;
/** @param {string} path */
const pathHash = (path) => createHash('sha256').update(path).digest().readUInt8(0);

/** Texture parts follow co-demand families instead of the whole boot's hash
 * cuts. The runtime still requires every member to be requested together;
 * nothing here authorizes a speculative read of a different texture set.
 * @param {readonly string[]} paths
 * @param {(path: string) => number} sizeOf
 * @returns {string[][]}
 */
export function bootPackParts(paths, sizeOf) {
  /** @type {string[][]} */
  const parts = [];
  /** @type {string[]} */
  let current = [];
  let bytes = 0, family = '';
  /** @type {Set<string>} */
  const slots = new Set();
  const flush = () => {
    if (current.length > 0) parts.push(current);
    current = []; bytes = 0; family = ''; slots.clear();
  };
  for (const path of paths) {
    const size = sizeOf(path);
    const texture = /^(.*\/)([^/]+)-[a-f0-9]{8}\.ktx2$/u.exec(path);
    const directory = texture?.[1] ?? '';
    const slot = texture?.[2] ?? '';
    // Dotted model.kind.variant names load per model, not per directory.
    // Tier suffixes and ordinary material slots do not create namespaces.
    const namespace = /^([^.]+)\.[^.]+\./u.exec(slot.replace(/\.(?:phone|desktop)$/u, ''))?.[1];
    const cohort = directory === '' ? '' : `${directory}${namespace ?? ''}`;
    // Different revisions of a slot (e.g. two diffuse hashes) belong to
    // independent sets, even when their public directory is the same.
    if (cohort !== family || directory !== '' && (slots.has(slot) || bytes + size > PART_MAX)) flush();
    current.push(path); bytes += size; family = cohort;
    if (directory !== '') {
      slots.add(slot);
      if (bytes >= PART_MAX) flush();
    } else {
      // Preserve the predecessor's hash cuts and image-before-glTF adjacency
      // for every non-KTX2 run. Only texture transport grouping changes.
      const image = /\/textures\/[^/]+$/u.test(path);
      if (!image && (bytes >= PART_MAX || bytes >= PART_MIN && pathHash(path) % 4 === 0)) flush();
    }
  }
  flush();
  return parts;
}
