# Record the E7 sitting at the actual wire and correction boundaries

E7.8a was missing: the real API rejected room records with400, no client net
record was emitted, and PLAYTEST created no operator file. API b33fb14 now
admits anonymous room/net records;981f61e retains unavailable RTT as null.
No API deployment or private credentials are used by this source work.

An online session reports actual decoded packets, rendered-player update
frames, sampled RTT, correction counts by foot/board/swim/ride, largest full
offset including snapped corrections, and successful reconnect count/time.
Counters are five-minute deltas and flush on pagehide, disposal and terminal
close. Initial loading/dials are not reconnects or play time. Parked wire
delivery and first-row preparation do not count as rendered game frames.
The existing anonymous telemetry install and API sink are reused. An optional
WILDSHARD_RECORD_TAG stamps the sitting label beside the signed release/key;
the release channel is the default. No URL switch, name or device is recorded.

PLAYTEST=1 creates an asynchronous bounded JSONL writer under /var/log/wildshard
(PLAYTEST_DIR only selects the operator directory). Settled native weapon
queries carry requested/applied rewind ages beside damage, not on the game
wire. The callback observes actual settled damage and changes no hit rule.
Only this flag advertises the socket playtest capability. Actual client
corrections then use a strict bounded control record under existing socket
size/flood credit. They are client observations, never movement/save authority.
Disk failure or backlog loss logs explicit dropped counts and does not stop
the cell. Shutdown drains the writer. Operator files contain neither names,
device identifiers, IPs nor chat. The existing game NET_SCHEMA_HASH is unchanged.

The outside-hook E7 proof runs two real socket seats on cooked Driftwood with
the real Player predictor. It records an actual correction and a settled
twenty-tick query clamped to twelve, reads actual JSONL and invokes the table
CLI on those real records. A second case refuses an over-bound control row,
fails real disk I/O, and observes the actual cell/frame clock keep advancing.
Both cases pass in about one second of test time, two seconds total runner
wall, with no skip. Original player/hook/online cases14/14 pass as well.

The table accepts room/net Blob JSONL exports and playtest/journald JSONL,
prints per-session RTT, corrections/min by mode, full offset, frames/s and
reconnect totals, plus server worker-window p95 and J127's clamped share of
settled network hits. Unknown RTT/readings/completeness stay unknown, and
loss is explicit. More than25percent clamped flags review; it never changes
the twelve-tick cap. A real sitting and actual hosted Blob receipt remain
operational proof, not credited by a local storage double.

Phase2's sandbox uses /var/lib/wildshard/logs. Its owner j189 explicitly sets
PLAYTEST_DIR to that owned writable root in the unit and documents it; the
direct-launch default remains the original /var/log/wildshard path. No global
directory permission or VPS setting is changed by this lane.

The operator CLI can fetch the actual authenticated day/tag export directly
with --api/--day/--tag and WS_TELEMETRY_REVIEW_PASSWORD supplied by the operator;
it reads no credential file and prints no password. The real API route export
has old400/new200 evidence, preserving401 without authentication. The engine
proof also runs the actual CLI against a real loopback HTTP export of its live
records. Normal non-playtest server queries allocate no rewind metadata.

Publication is held through port's v0.1.3 tag window. Page and server must be
built from the later same committed build to use these additions.
