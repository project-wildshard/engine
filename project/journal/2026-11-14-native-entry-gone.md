# The app's native entry is gone from engine (buddy-engine, TEST-COVERAGE row 11a)

- Row 11a asked that `native.html`, `src/client/app/native.ts`,
  `client/native/` and `@capacitor/*` leave engine, with `native-escape`
  still passing (J176). Checked on main `fd95a249`+: none of them is in
  the tree or in package.json; the lift never carried them over.
- What was left: `.oxlintrc.json`'s default-export override still named
  `capacitor.config.ts`, `drafts/vite.config.ts` and
  `admin/vite.config.ts`, none of which exists. Dropped them.
- `test/tooling/parity/browser-escape.test.mjs` (the native-escape
  proof): 8 of 8 green.
