# The previous wire release comes from npm

> Written by: Codex
>
> **State:** WR6 fixture check updated 2026-11-18 for engine wire 1.2.

Engine `ab4729ff` pins the previous minor as an exact npm alias.
The lock test now checks the alias importer and registry integrity.
The cross-version harness still plays current wire against that
previous minor.
