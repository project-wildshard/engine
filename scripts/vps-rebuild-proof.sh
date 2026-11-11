#!/usr/bin/env bash
# MMO-PLAN MP0.1's proof: scripts/vps/rebuild.sh on a throwaway box, never the VPS. A blank Ubuntu 24.04 container that boots
# systemd stands in for a fresh Hetzner image; only systemd is added to it, so the script installs the rest. It runs on the Mac's
# own architecture (arm64): under Rosetta's amd64, systemd's own services (journald, tmpfiles, PostgreSQL's unit) fail to start.
#   bash scripts/vps-rebuild-proof.sh [--keep]     needs Docker; writes tmp/vps-rebuild-proof/<stamp>/; removes its container
# What is stubbed, and why: `tailscale` (joining a tailnet is Jake's, so a stub plays a logged-in node and records the
# Serve/Funnel routes Phase 2 asks for), and the cook worker's API (a local catalogue of one pinned shardfile, so the box
# cooks for real into a folder and writes no R2 object). api.wildshard.io resolves to nothing inside the box, so the
# servers' records never reach it. The servers pull the real signed releases and bundles, read-only, as a fresh VPS would.
# The runs, in order: --check; a first run that waits for Tailscale; `tailscale up`; a run that does Phase 2 and waits for
# cook.env; cook.env filled; a run that installs and starts the cook worker; and a last run that must change nothing.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
KEEP=0; if [ "${1:-}" = --keep ]; then KEEP=1; fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ) NAME=ws-rebuild-proof-$$ IMAGE=ws-rebuild-proof:noble
OUT=$ROOT/tmp/vps-rebuild-proof/$STAMP
COOK_REF=${COOK_REF:-v0.1.6}
# blender-template revision 2 (test/pins/catalogue.json), the smallest pinned shardfile.
SHARD_SLUG=blender-template SHARD_REVISION=2 SHARD_HASH=fbd3aba57d66811ef4bc2ecda1b6c4bfd23e6d55a2f54eb85c6a7cbb28316f02
SHARD_FILE=${WS_PINS_DIR:-$HOME/.cache/wildshard/pins}/$SHARD_HASH.tar
mkdir -p "$OUT/image"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$OUT/proof.log"; }
fail() { log "FAIL $*"; exit 1; }
cleanup() {
  if [ "$KEEP" = 1 ]; then log "kept container $NAME"; return; fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT
if [ ! -f "$SHARD_FILE" ]; then fail "missing pinned shardfile $SHARD_FILE (pnpm pins fills it)"; fi
if [ "$(shasum -a 256 "$SHARD_FILE" | cut -d' ' -f1)" != "$SHARD_HASH" ]; then fail 'pinned shardfile differs from its hash'; fi

# --- The blank box: the stock image plus systemd, which every cloud image boots with.
cat > "$OUT/image/Dockerfile" <<'EOF'
FROM ubuntu:24.04
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus \
 && rm -rf /var/lib/apt/lists/* && mkdir -p /root/.ssh && chmod 700 /root/.ssh \
 && printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIProofOnlyNotARealKeyProofOnlyNotARealKey0 proof\n' > /root/.ssh/authorized_keys
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
EOF
log "build $IMAGE"
docker build -q -t "$IMAGE" "$OUT/image" >/dev/null
log "start $NAME"
docker run -d --name "$NAME" --hostname scratch-box --privileged --cgroupns=private \
  --tmpfs /run --tmpfs /run/lock --add-host api.wildshard.io:0.0.0.0 "$IMAGE" >/dev/null
box() { docker exec "$NAME" "$@"; }
for _ in $(seq 1 60); do if box systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded'; then break; fi; sleep 1; done
box systemctl is-system-running 2>&1 | tee -a "$OUT/proof.log" || true

# --- What the box gets: scripts/vps as committed here, the tailscale stub, the stub API and the shardfile.
box mkdir -p /root/wildshard/scripts /root/proof
docker cp "$ROOT/scripts/vps" "$NAME:/root/wildshard/scripts/vps"
docker cp "$SHARD_FILE" "$NAME:/root/proof/$SHARD_HASH.tar"
cat > "$OUT/tailscale" <<'EOF'
#!/usr/bin/env node
// The proof's tailscale: a node named scratch-box.tail0000.ts.net once `tailscale up` has run. Serve and Funnel
// commands edit the same JSON `tailscale serve status --json` prints, and every call is logged.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = '/var/lib/tailscale-stub', up = `${dir}/up`, state = `${dir}/serve.json`, host = 'scratch-box.tail0000.ts.net';
mkdirSync(dir, { recursive: true }); const args = process.argv.slice(2);
appendFileSync(`${dir}/calls.log`, `${args.join(' ')}\n`);
const serve = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : {};
const save = () => writeFileSync(state, JSON.stringify(serve));
const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const route = (port, protocol, target, funnel) => {
  serve.TCP = { ...serve.TCP, [port]: { [protocol]: true } };
  serve.Web = { ...serve.Web, [`${host}:${port}`]: { Handlers: { '/': { Proxy: target } } } };
  if (funnel) serve.AllowFunnel = { ...serve.AllowFunnel, [`${host}:${port}`]: true };
  save();
};
const [command] = args;
if (command === 'up') { writeFileSync(up, '1'); process.exit(0); }
if (command === 'status' && args.includes('--json')) {
  console.log(JSON.stringify(existsSync(up) ? { BackendState: 'Running', Self: { DNSName: `${host}.` } } : { BackendState: 'NeedsLogin', Self: {} }));
  process.exit(0);
}
if (command === 'status') process.exit(existsSync(up) ? 0 : 1);
if (!existsSync(up)) { console.error('not logged in'); process.exit(1); }
if (command === 'ip') { console.log(args.includes('-4') ? '100.64.0.9' : 'fd7a:115c:a1e0::9'); process.exit(0); }
if (command === 'serve' && args[1] === 'status') { console.log(JSON.stringify(serve)); process.exit(0); }
const target = args.at(-1);
if (command === 'serve' && flag('http')) { route(flag('http'), 'HTTP', target, false); process.exit(0); }
if (command === 'funnel' && flag('https')) { route(flag('https'), 'HTTPS', target, true); process.exit(0); }
console.error(`stub: unhandled ${args.join(' ')}`); process.exit(2);
EOF
cat > "$OUT/stub-api.mjs" <<EOF
// The proof's api-server: a catalogue of one live shard, and its shardfile by hash.
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
const hash = '$SHARD_HASH';
createServer((request, response) => {
  if (request.url === '/api/catalogue') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ shards: [{ slug: '$SHARD_SLUG', live: { revision: $SHARD_REVISION, hash } }] })); return; }
  if (request.url === \`/api/shardfiles/\${hash}\`) { response.writeHead(200, { 'content-type': 'application/x-tar' }); createReadStream(\`/root/proof/\${hash}.tar\`).pipe(response); return; }
  response.writeHead(404); response.end();
}).listen(8793, '127.0.0.1');
EOF
docker cp "$OUT/tailscale" "$NAME:/usr/local/bin/tailscale"
docker cp "$OUT/stub-api.mjs" "$NAME:/root/proof/stub-api.mjs"
box chmod 755 /usr/local/bin/tailscale

# A run's output and exit code, kept.
run() {
  local label=$1 status; shift
  log "run $label: rebuild.sh $*"
  set +e; box bash /root/wildshard/scripts/vps/rebuild.sh "$@" > "$OUT/$label.txt" 2>&1; status=$?; set -e
  log "run $label exit $status ($(grep -c '^doing' "$OUT/$label.txt" || true) doing, $(grep -c '^wait ' "$OUT/$label.txt" || true) wait)"
  printf '%s' "$status" > "$OUT/$label.exit"
  return 0
}
expect_exit() { [ "$(cat "$OUT/$1.exit")" = "$2" ] || { tail -30 "$OUT/$1.txt"; fail "$1 exited $(cat "$OUT/$1.exit"), expected $2"; }; }

run 0-check --check
[ "$(box sh -c 'command -v node || true')" = '' ] || fail '--check installed node'
run 1-blank
expect_exit 1-blank 2; grep -q 'Tailscale is not logged in' "$OUT/1-blank.txt" || fail 'first run did not wait for Tailscale'
log 'tailscale up (Jake, on the real box)'; box tailscale up
run 2-tailnet
expect_exit 2-tailnet 2; grep -q 'Phase 2 complete' "$OUT/2-tailnet.txt" || fail 'Phase 2 did not complete'
grep -q "Fill /etc/wildshard/cook.env" "$OUT/2-tailnet.txt" || fail 'second run did not wait for cook.env'

log 'fill cook.env (a folder store and the stub API) and start the stub API'
box sh -c "cat > /etc/systemd/system/proof-api.service <<'UNIT'
[Service]
ExecStart=/usr/bin/node /root/proof/stub-api.mjs
UNIT
systemctl daemon-reload && systemctl start proof-api.service"
box sh -c "sed -i -e 's|^COOK_ENGINE_REF=\$|COOK_ENGINE_REF=$COOK_REF|' -e 's|^WILDSHARD_BUILD=\$|WILDSHARD_BUILD=proof-$COOK_REF|' \
  -e 's|^WILDSHARD_API_URL=.*|WILDSHARD_API_URL=http://127.0.0.1:8793|' -e \"s|^COOK_NOTIFY_TOKEN=\$|COOK_NOTIFY_TOKEN=\$(openssl rand -hex 24)|\" \
  -e 's|^# COOK_STORE_DIR=.*|COOK_STORE_DIR=/var/lib/wildshard-cook/store|' /etc/wildshard/cook.env"
run 3-cook
expect_exit 3-cook 0
run 4-again
expect_exit 4-again 0
if grep -q '^doing' "$OUT/4-again.txt"; then grep '^doing' "$OUT/4-again.txt"; fail 'the last run changed something'; fi

# --- The box serves: real servers (not the stubs) on both loopback ports, and a cooked shard in the store.
for channel in production staging; do
  port=$([ "$channel" = production ] && echo 8790 || echo 8791)
  for _ in $(seq 1 90); do
    health=$(box curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null || true)
    if [ -n "$health" ] && ! printf '%s' "$health" | grep -q '"stub":true'; then break; fi
    sleep 5
  done
  printf '%s\n' "$health" > "$OUT/health-$channel.json"
  if printf '%s' "$health" | grep -q '"stub":true' || [ -z "$health" ]; then
    box journalctl -u "wildshard-pull@$channel" -u "wildshard-server@$channel" --no-pager -n 60 > "$OUT/journal-$channel.txt" 2>&1 || true
    fail "$channel still serves its stub: $health"
  fi
  log "$channel /health: $(printf '%s' "$health" | cut -c1-220)"
done
for _ in $(seq 1 120); do
  index=$(box sh -c "ls /var/lib/wildshard-cook/store/index/proof-$COOK_REF/$SHARD_HASH.json 2>/dev/null" || true)
  if [ -n "$index" ]; then break; fi
  sleep 5
done
box journalctl -u wildshard-cook --no-pager -n 80 > "$OUT/journal-cook.txt" 2>&1 || true
[ -n "$index" ] || fail 'the cook worker wrote no index for the shard'
log "cook index: $index; $(box sh -c "find /var/lib/wildshard-cook/store -type f | wc -l") objects in the store"
box curl -fsS http://127.0.0.1:8792/health > "$OUT/health-cook.json"
log "cook /health: $(cat "$OUT/health-cook.json")"
box sh -c 'cat /var/lib/tailscale-stub/calls.log' > "$OUT/tailscale-calls.log"
box sh -c 'ss -ltnH' > "$OUT/listeners.txt"
box systemctl list-units --no-pager --all 'wildshard*' 'caddy*' 'postgresql*' > "$OUT/units.txt" 2>&1 || true
grep -qE ':(80|443) ' "$OUT/listeners.txt" && fail 'something listens on port 80 or 443'
box systemctl is-enabled caddy.service > "$OUT/caddy-enabled.txt" 2>&1 || true
log "caddy: $(cat "$OUT/caddy-enabled.txt")"
log "PASS: blank box to two serving channels and a cooking worker; evidence in $OUT"
