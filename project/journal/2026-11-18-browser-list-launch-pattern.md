# The browser-list check matches browser launches, not projectiles

Main's `gate-related-tests.test.ts` failed: "every Vitest file that
launches a real browser is on the browser list" wanted
`test/creature-volume-weapons.test.ts`, which arrived with 8612d46e.
opus-flow saw it first. That test never opens a browser. It calls
`law.launch(from, velocity)` on a projectile law, and the check's
pattern `\.launch\(` caught it.

Adding the file to BROWSER_TESTS would have pushed a fast unit test out
of the 74-second push gate and onto hosted CI only. Instead the check
now requires a Playwright browser type,
`(chromium|webkit|firefox).launch(`, plus the two CDP and
persistent-context forms. Every real launch in the tree is written that
way. Earlier projectile matches already on the list (headless-combat,
javelin-flight) stay where they are. Whether they belong there is a
separate question.
