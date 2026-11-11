# preview.wildshard.io comes from engine

Meta SHELL-CUTOVER SC1 (J172, J209, J210). preview.wildshard.io still
served the singleplayer shell's build (`02f7d1c`), deployed by hand from
that repo. J209 makes it the solo build of every engine push.

`.github/workflows/preview.yml` runs once an hour (and by hand): it
takes the newest main commit whose `ci` run is green, checks it out, installs the pins, builds the game with no world
stamp (so the in-page server runs, the solo preview), strips source maps,
and deploys the folder prebuilt as the production deployment of the
Vercel project that owns preview.wildshard.io (`wildshard-singleplayer`).
Then it reads preview.wildshard.io/version.json until it names this
build. One run at a time.

The token is a new secret, `VERCEL_PREVIEW_TOKEN`, the long-lived
raynos-projects token: a CLI login token expires in 8 hours. The project
id sits in the workflow, as API-SERVER-CD's ship.sh does.

The site's doctor link the plan meant to move doesn't exist: wildshard.io
links play, staging and preview, and no doctor page. `?doctor` keeps
working on preview because the deployed vercel.json carries its redirect.

Vercel spend (VERCEL-SPEND-PLAN, coordinator's fix before land): the
workflow first reads the live preview's build, and if that commit is in
engine's history and no client input changed since (src/client,
src/shared, the pins, the build tooling, the lockfile, vercel.json), it
deploys nothing. Otherwise it builds here and deploys `--prebuilt`
(`vercel pull`, `vercel build`, `vercel deploy --prebuilt --prod`; the
project is already on the basic machine), then prunes superseded
deployments with the shared `scripts/prune-deployments.mjs` (opus-vercel
lands engine's copy; this workflow only calls it). Dry run on this Mac:
the solo build is 2.4 GB without maps, and `vercel build` turns it into
`.vercel/output/static` with the `?doctor` redirect in its routes.

Hourly, not per push (coordinator, from opus-vercelbuild's Build CPU
numbers): 131 of the last 24 hours' 410 main commits touched a client
input, and a deploy per green main would have doubled the Vercel bill.
At most 24 deploys a day; most hours skip.
