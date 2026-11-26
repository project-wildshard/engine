// HOW-WE-BUILD WL21a: engine policy around the portable copy-before-remove helper.
// Recompute hashes for every call: changed, unknown and unverifiable bytes remain work.
import { keepCopy as copyState, worktreeState as snapshotState } from './.kit/keep-copy.mjs';
import { verifiedPinsOutputs } from './pins-reuse.mjs';

/** @param {string} root */
export function worktreeState(root) {
  return snapshotState(root, { regenerableFiles: verifiedPinsOutputs(root).paths });
}

/** @param {string} root @param {{keepRoot?:string,now?:Date}} [options] */
export function keepCopy(root, options = {}) {
  return copyState(root, { ...options, regenerableFiles: verifiedPinsOutputs(root).paths });
}
