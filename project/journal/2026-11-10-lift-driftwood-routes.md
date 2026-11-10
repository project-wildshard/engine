# Restore the original Driftwood native routes

The original eight registered gameplay cases failed before their first leg:
their worker imported removed @wildshard/commons through the old test facade.
The fixed worker now installs engine public portable math. Its bootstrap already
installs this same engine math before importing the factory; no game math or
oracle has changed. The original test file is byte-identical.

Actual pinned Driftwood product admission plus the original one-worker run under
global full-test ticket18410 failed with eight skipped cases and a failed suite.
After the import change, ticket18411 passed all eight original cases in3.58s;
complete-module diagnostics3507.043374ms. The original failed run log remains.
No deadline, native cohort, case cap, file budget or shard limit changes.

This restores real product/worker/physics/play boundaries, with the original
living-world leg order and disposal checks. It claims no UI or browser proof.
Both-ring complete timing bootstrap and planner validation precede publication;
exact hosted CI and Ring1 proof are still required before completion credit.

One-shot review has no MUST; its SHOULD is closed by recording all eight exact
case titles from the actual passing reporter, rather than one summary label.

Actual complete-module local bootstrap clocks (not Linux observations):
{
  "clocksMs": {
    "full": 3484.3267499999997,
    "1": 3485.756624
  },
  "planner": [
    {
      "ring": "full",
      "files": 1203,
      "shards": 12,
      "maximumSeconds": 227.13839949265002
    },
    {
      "ring": "1",
      "files": 1118,
      "shards": 8,
      "maximumSeconds": 225.41552396844997
    }
  ]
}
Both reports bind the unchanged test blob, committed tree and completed zero
process exit; no skipped or absent cases are used as timing evidence. Existing
60s file/300s shard budgets, factor1.35, setup70s and20% headroom are unchanged.
