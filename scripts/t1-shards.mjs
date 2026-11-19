// Stable suite ownership: adding a spec requires assigning it here. Each suite runs on its own hosted runner within one
// 120 s budget (TR-4): independent browser boots and the dev world have their own runners.
export const T1_SHARDS = Object.freeze({
  A: /\/(?:boot|probe|content)\.spec\.ts$/u,
  B: /\/saves\.spec\.ts$/u,
  C: /\/(?:phone|layers)\.spec\.ts$/u,
  D: /\/online\.spec\.ts$/u,
  E: /\/journey\.spec\.ts$/u,
  F: /\/journey-ways\.spec\.ts$/u,
  G: /\/fixtures\.spec\.ts$/u,
  H: /\/saves-exit\.spec\.ts$/u,
  I: /\/released-save\.spec\.ts$/u,
  J: /\/dev-world\.spec\.ts$/u,
  K: /\/online-entry\.spec\.ts$/u,
  L: /\/online-packs\.spec\.ts$/u,
});
