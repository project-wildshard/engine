# Keep the compiler orchestration proof current

The clean full gate executes all 1,144 files and exposes two stale
assertions in lint-all: the script now invokes the declared npr compiler,
but its exact-command checks still expect the removed local tsc binary.
Update only that command prefix. The one complete check, builder count,
verified inputs, real concurrent process trace, drain and failure status
assertions remain unchanged. No timing/sample/quarantine policy changes.
