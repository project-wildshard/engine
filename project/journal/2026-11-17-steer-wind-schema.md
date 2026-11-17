# 2026-11-17 the sail wind in the JSON Schema bridge (opus-ss10h)

Format 0.21.0 checks a steer sail's wind with `someItem` (the direction
may not be all zeros). The valibot JSON Schema bridge has no lowering
for that action, so converting the movers document threw. Engine tests
never converted movers with a wind, but sharddev's dev tests do, through
this module, once sharddev pins 0.21.0. The bridge now writes it as
`not: { items: { const: 0 } }`, the same rule in JSON Schema.
