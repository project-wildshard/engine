# main-watch names the agent that runs it (QA 11-26 row 11)

Lane opus-qa-tools. Since meta's QA writer takes its author only from a
required `--agent`, main-watch passed `WS_AGENT`, and nothing set it: a
budget regression logged "memory QA skipped ... no WS_AGENT" and filed no
QA row. main-watch has no launchd or cron tick on either machine; land,
main-push and the pre-push start it from an agent's shell, so it inherits
that agent's environment. `src/scripts/runner-agent.mjs` now names the
runner: `WS_AGENT` when set, else the model in its own session log
(Claude's `CLAUDE_CODE_SESSION_ID` transcript, newest assistant line;
Codex's `CODEX_THREAD_ID` rollout, newest turn_context). No log, no
model: no QA row, the old skip receipt. Never a default.

An Agent-tool subagent shares its parent's session log, so it names the
parent's model.

Guard: `src/scripts/test/main-watch-red.test.mjs` row 11 test: a budget
alarm through `liveIo().memoryQa` hands a stand-in writer `--agent
claude:claude-opus-5-5` read from a made-up transcript, and Codex's too.
