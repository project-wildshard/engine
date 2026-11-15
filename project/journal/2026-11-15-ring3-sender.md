> Written by: Codex
> State: built on plan/tc-pins, 2026-11-15.

Ring 3 now fans out exact engine candidates to the seven existing shard
receivers after a green Ring 2. Use workflow_dispatch's returned run IDs
instead of guessing which engine-candidate run is ours. Follow every
receiver, file a deduplicated issue for each red candidate and retain one
JSON/Markdown aggregate. This publishes evidence only; the MacBook ships.
The existing dedicated nightly App must have installation access and
Actions/Issues write on those repos; configuration is left to Jake.
