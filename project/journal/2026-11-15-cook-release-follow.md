# Cook release follow (codex-ms)

- MS2.4a: cook credentials stay in `cook.env`; a verified staging release now
  writes the root-only tag/build state. The five-minute timer calls the
  constrained cook-only rebuild path, which refuses a forged or mismatched tag
  before it can change the checkout.
- The release state lives under `/etc/wildshard`, not the cook-owned home, and
  checkout verification requires the signed tag to resolve to the exact signed
  engine commit. The existing MS2.4b read-only checkout rules remain in force.
- Focused Vitest startup is currently stopped by CI21's known deadline gate;
  shell/Node syntax and direct positive/forged/mismatched-release checks pass.
