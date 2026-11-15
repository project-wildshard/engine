// Stable suite ownership: adding a spec requires assigning it here.
export const T1_SHARDS = Object.freeze({
  A: /\/(?:boot|fixtures|probe|content)\.spec\.ts$/u,
  B: /\/(?:saves|released-save)\.spec\.ts$/u,
  C: /\/phone\.spec\.ts$/u,
  D: /\/online(?:-entry)?\.spec\.ts$/u,
});
