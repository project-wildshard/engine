# Keep the test shim out of gate environment probes

Running the push profile or the release probe from a gate worker could
pass the worker's Node shim on to Git's compiler environment probe. The
bounded environment excludes `WS_GATE_NODE`, which that shim needs, so
the probe exited 127 before reaching its checks.

The environment builder removes the shim directory before probing Git.
The worker-limit test prepends the real shim to reproduce the nested
case. The local-candidate fixture also passes under that search path.
