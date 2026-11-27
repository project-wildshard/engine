# Cap push-gate test workers

Use a quarter of the available cores for Node and Vitest in the push
gate. Use the same limit for the Vitest CPU broker. Set
`WS_GATE_WORKERS` to override the limit. Native tests keep their existing
single-worker setup.
