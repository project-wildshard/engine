# J245: Settings is layout A, the Bag's tabs

Jake picked from the variants board, ~22:55 Cancún: "Settings, let's do A,
like the bag. The tabs at the top, 5 tabs. Developer mode is on, 6 tabs.
Yep, good." Plan: meta `docs/plans/SETTINGS-REDESIGN-PLAN.md`.

The prototypes re-parented rows the old column built. The real build drops
that: `menuSettings.ts` puts every row straight into a named group of a tab
(`settingsTabs.ts` GROUPS), and `settingsCats.ts` (the phone column and the
desktop rail), the layout picker and B to E are gone. The touch button is a
cog and SETTINGS, and the menu title reads Settings.

Graphics renders a registry, `graphicsControls.ts`, merged over its
built-ins (Low / High, quality, render scale, AA, the reload row, the
first-play replay). The Low / High lane (MOBILE-GRAPHICS MG8+) registers
its screen, scale, effects and frame-time toggles there instead of editing
the menu; a registration with a built-in's id replaces it. The game
reaches it as `@wildshard/engine/ui/graphicsControls`.

`test/settings-tabs-browser.proof.mjs` mounts the real GameMenu in
Chromium, phone and desktop, opens every tab and works every control
against a list written from the plan, not read from the page. It caught
one thing on its first full run: the reload row showed "0 changes"
after a reopen, because `when` ran after its own paint.

Gotcha: a substring filter for `.ws-gmenu-pane` also matched
`.ws-gmenu-panel`, and took the menu's base panel rules with it.

The two deleted modules go in their own commit, with nothing else code in
it. The commit lane's typecheck stamps the renderer revision from
`git ls-tree HEAD`, so a commit that edits code and deletes a tracked
`src/client` file stops with ENOENT. Worth a fix in the stamp: hash the
index, not HEAD.

Codex's review (J206) found the registry's lifecycle loose: a replaced or
unregistered control kept its listeners, a late registration's
subscriptions belonged to whoever registered it, and a stale disposer
could drop a newer registration of the same id. Each control now builds
under its own child of the menu's scope, disposed with its row.
