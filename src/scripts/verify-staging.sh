#!/usr/bin/env bash
# Meta STAGING-QA SQ15 (J426-J428): the staging proofs are one runner now, src/scripts/staging-qa.mjs, and production go-live reads
# its verdict (page-release.mjs --qa). This name stays as a thin call: the live staging leg on the build staging serves.
#   bash src/scripts/verify-staging.sh [<staging-qa.mjs options>]   e.g. --only K3 --out tmp/verify-staging
# The journeys per browser, both zone sweeps, Doctor and the live two-player proof it used to run (about 42 minutes a release,
# J427) are folded into staging-qa.mjs's legs or retired: SQ9's K6 enters every Shard Select card, K3 and K4 hold the journey.
set -euo pipefail
cd "$(dirname "$0")/../.."
WS_AGENT_UA=$(node --input-type=module -e 'import { agentUserAgent } from "./src/scripts/agent-marker.mjs"; console.log(agentUserAgent("curl"));')
version=$(curl -A "$WS_AGENT_UA" -fsS --max-time 30 https://staging.wildshard.io/version.json | node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0,"utf8")).clientVersion)')
exec node src/scripts/staging-qa.mjs --release "v$version" "$@"
