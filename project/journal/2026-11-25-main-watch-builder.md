# main-watch reaches lanes with no pane

Meta QA 11-25 row 21 (lane opus-kit). Engine main went red on
2026-11-25 (run 45569694131, `e2bd1e857d..fc0832b529`, boundaries and
tests 9) and main-watch's receipts said `MAIN RED message ... not
delivered`: the lander was an Agent-tool subagent, which has no herdr
pane or agent, and the coordinator-pane fallback (`w2:p5`) was gone.

- Every reported red writes `NOTE RED <lane>: run <id> <range> <jobs>`
  per lander. A lane's one background wait on the receipts log matches
  its own name, so it learns of its red without a pane.
- The fallback and the keeper (J443) now go by `hc send` to the
  builder's terminal: `WS_MAIN_WATCH_BUILDER`, else the live hc
  terminal labelled `goal=saga-builder`. hc refuses a gone or blocked
  terminal, and that is logged as not delivered.
- `FALLBACK_PANE` and `WS_MAIN_WATCH_FALLBACK_PANE` retire.
