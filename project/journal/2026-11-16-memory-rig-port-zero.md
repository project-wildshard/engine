# Memory rigs own their bound ports

DS20b1 removes T1's adjacent-port probe/close race and environment mutation.
`openRig({port: 0, saves: 'memory'})` claims a fresh fixture, validates its
private key, and binds its release, page and world doors independently.
Page/world TCP fronts retain their OS-assigned ports while replacement
children bind zero and report their actual listener over owned child IPC.
There is no port registry. Only loopback TCP bytes are forwarded, including
WebSocket upgrades; the signed release and allowed browser origins use the
instance's actual doors. Legacy explicitly named rigs retain their defaults.
Native database zero mode remains refused until DS20b2 qualifies it.

The batch review found T1 publishing serial 2 merely to advertise its bound
chaos endpoint. The world correctly drained six seconds later. T1 now owns
a public world front before signing serial 1 and points that held listener
at the bound proxy. No synthetic deploy occurs. The native test first
failed with a 502 after eight seconds; it now discovers the real world
again beyond that grace period. Explicit stop also retains forwarding
until child exit so the world can send its drain message. The combined
cache/memory/native-PostgreSQL controls pass all 17 cases locally. Hosted
qualification of this repair remains open; no landing has started.

The dedicated host reports its bound port rather than the requested zero.
An IPC parent's departure drains its world and saves; standalone production
processes keep their existing signal lifecycle. Duplicate shutdown is guarded.
The only game-host change is listener reporting/lifetime, not the protocol.

The red-first real parallel start produced one fulfilled and one rejected rig
because both used the fixed release port. Native controls now start two real
Template worlds, verify distinct ports, signed release destinations, HTTP
version/health and actual byte-9 WebSocket discovery. A third real T1 proxy
admits discovery from its actual page origin. World restart, page replacement,
closing one sibling, and refusal of a foreign occupied listener all retain
ownership. Forged-child readiness is refused. All 13 focused controls pass;
lint/type/CSS and exact hosted CI qualification follow before the row tick.
The transport fixture supplies a small cooked road; full T1 CI uses its actual
app-baked grid. No rendering acceptance is inferred from the transport test.

The T1 CLI itself also had a remaining probe-close allocator for its preview.
It now starts preview-server with `--port 0`, awaits its owned child's actual
IPC address, keeps it alive through Playwright and stops it afterward. The
Playwright config uses that already-owned listener; manual named-port runs
retain their own webServer path. A native CLI control runs two launchers with
an HTTP client as their browser command: both old launchers failed to serve
the allocated address; both repaired launchers serve distinct actual ports
and those listeners refuse connections after exit. Actual game/browser
acceptance remains the hosted T1 groups, not this native lifecycle control.

Hosted CI 43996503502 caught the T1 launcher fixture borrowing a locally
pre-owned lane directory: fresh CI had no owner and correctly refused it.
Each native launcher now receives its own fresh scratch root and asserts its
owner file there. Normal launchers retain their repo-root default. The
ownership refusal stays enforced; the test no longer depends on local state.
