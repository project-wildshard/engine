# Published engine source uses its build's wire

A fresh sharddev install of the engine archive resolved wire 1.4.0
through the engine's `^1.3.0` dependency. The frozen engine build still
used 1.3.0. Published engine source binds each wire field, so the
installer's 1.4.0 added two required animal bindings that this build
does not have.

An exact wire pin keeps clean consumers on the same schema as the
frozen server and client builds. The lockfile test requires that exact
version and its registry integrity record.
