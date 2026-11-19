// Stable suite ownership: adding a spec requires assigning it here. Each suite runs on its own hosted runner within one
// 120 s budget (TR-4): the phone journey's boots are their own two suites, E and F.
export const T1_SHARDS = Object.freeze({
  A: /\/(?:boot|fixtures|probe|content)\.spec\.ts$/u,
  B: /\/(?:saves|released-save)\.spec\.ts$/u,
  C: /\/(?:phone|layers)\.spec\.ts$/u,
  D: /\/(?:online(?:-entry)?|dev-world)\.spec\.ts$/u,
  E: /\/journey\.spec\.ts$/u,
  F: /\/journey-ways\.spec\.ts$/u,
});
