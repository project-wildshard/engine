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
