# SQ8 record the staging release order

The runbook now puts local QA on the green source, then checks the
unaliased Worker and signed staging rooms before the candidate leg. The
alias command carries both verdicts and the live leg follows it. The
runner's train dry-run shows the same sequence and uses the M3 leg lists.
