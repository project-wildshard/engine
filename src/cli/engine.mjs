#!/usr/bin/env node
// The npm bin. Node refuses to strip types under node_modules, so an installed engine could not run main.ts itself.
// The format hook strips our own @wildshard packages' .ts there (J82). main.ts is a dynamic import: a static one
// would link its whole graph before the hook registers.
// oxlint-disable-next-line import/no-unassigned-import -- the hook must register before main.ts loads (J82)
import '../../scripts/format-hook.mjs'

await import('./main.ts')
