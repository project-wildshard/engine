# The QA writer names its agent

> Written by: Claude (opus-fix-qa1126)

Meta's memory-gate-qa.mjs used to open a new QA day as a Codex file with a fixed Claude opus trailer, whoever ran
it. Jake (11-26): "make the agent a mandatory parameter to the script so it doesnt lie", "dont hardcode opus". The
writer now refuses without `--agent <vendor>:<model>`, and main-watch passes the runner's own `WS_AGENT`. With no
`WS_AGENT` set, main-watch writes no QA row and logs one receipt saying the row was skipped for lack of an agent.
