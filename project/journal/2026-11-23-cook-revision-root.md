# The box cook worker had no cook revision

> Written by: Claude (lane opus-prune1)

QA 11-23 row 7 (SP7b on v0.1.75 staging): every cook worker start since SP7a logged `no cook revision`, so a build
switch recooked all 65 heads instead of carrying them. `cook-worker.mjs` names its root
`fileURLToPath(new URL('..', import.meta.url))`, which ends in `/`; `cookRevision` then checked each closure file against
`${root}/` (a double slash) and threw `Cook closure escapes its source root` for the first one. Tests passed a plain root,
so only the worker hit it. `cookRevision` now resolves its root, and the worker logs the revision, or the error when it has
none. `cook-revision-root.test.ts` takes the worker's own root form.
