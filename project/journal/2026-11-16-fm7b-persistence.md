# Report the committed document, not a queued save

FM7b3a observes the database boundary. writeSave returns whether its
conditional document write won, after the transaction returns. A stale
document can still file receipts atomically, while supplying no new
document confirmation. Existing sequence/version guards and SQL stay
unchanged. A lost commit acknowledgement rejects even if bytes landed;
its stale retry remains unknown until a new document is acknowledged.

The durable PlayerSaves implementation exposes optional per-player
reason/sequence observations. A queued void write, a memory store and a
coalesced/stale document supply no false success. Listener exceptions
cannot turn a committed transaction into a persistence failure. No
account expiry, client clock or guessed save timestamp is asserted.

Real database tests hold a commit, cause an actual SQL constraint refusal,
exercise stale/lost-ack recovery, and check observer isolation. The live
world9 carrier remains FM7b3b; no game-wire layout or UI changed here.

Local qualification: 18 SQL/store controls pass on PGlite, and the five
new boundary cases pass again over pg/TCP against fresh native Postgres
clusters. Each native run verifies its connected data directory and
removes its cluster after stopping it. Full lint and types are green.
Hosted qualification and the live carrier remain open; no main push.

FM7b3b carries observations on an optional world9 status.persistence
branch, version one. The complete extension is bounded to 512 bytes,
with code, sequence and scope only. Other optional status branches are
independent; old discovery has no save claim. Only the matching player's
current socket hears an observation. Later words preserve cells/shards
and omit device:1, avoiding a new device snapshot. Unknown versions,
codes or invalid numbers are ignored. Account/session facts remain
FM7b3c, and graphical save presentation remains FM8s.

Netlag's parallel checkpoint witness (plan/mmo-sockets 29f6c4114) uses
status:{v:1,checkpoint}. Keep the common WorldWord extension generic;
each branch validates its own bounded fact. The persistence reader ignores
other branches, and the two server emitters use separate messages. This
avoids making a checkpoint require a persistence observation on rebase.
