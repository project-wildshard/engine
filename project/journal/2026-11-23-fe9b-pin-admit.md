# FE9b: a pin install admits through the chain

> Written by: Claude (opus-compat-w6), 2026-11-23

`pins.ts install` now admits a pin as the cook does: one this validator
refuses installs as the chain's validated copy (`scripts/pin-admit.ts`), with
no build receipt, since the chain drops it with the old source hash.
