# SR1 and SR7 share one publication

Rebased SR1 through SR4 and the additive scope/duration repair from
d9c180362dc3790f0f477b9caae0f5fa30febfb9 beside SR5 through SR8, onto
engine-test publication 9059d6ba175e6e87a0dc358682078eb4d95efb5e.
The owner's clone remains untouched. The original duplicate SR1 import
was omitted; this commit keeps only the stronger combined proof.
The combined wire schema hash is 3951578209. Epoch-one inline guards
and serverSaveDatabase remain intact. LS1 follows this source batch.

The combined Sunscar whip proof passed three fresh boots in Chromium and
three in WebKit. Each actual whip control produced exactly one NetHit,
one weapon.hit and one visible combat float, with zero local damage.dealt.
The proof also observed every creature HP write: zero outside showRow,
with 884–936 authoritative row writes in each run. No event was emitted
or HP changed by the proof. It observes setters and preserves their values.

After the ordered rebase and full 28-product build, all six fresh runs
passed again: three Chromium and three WebKit. Each retained one NetHit,
one weapon.hit, one float and zero local damage or HP writes outside
showRow. Authoritative row writes ranged from 910 to 936. All browsers
closed. The manual proof stays outside hooks and the unit-test glob.

S1's original stuck board was not reproduced by the SR4 source owner.
Actual process-loss recovery and the death/despawn ordering finding are
still open; the latter retains its production ordering. The full Opus
review is not closed by these repairs. No speculative fix is claimed.

The integration must publish with SR7 in the same push, never alone.
v0.1.1 now exists at 0d9e2381904a398721c36d94d25b8ed9b1f0707d.
The old port scratch was deleted after confirming that remote tag.
The normal full pre-push gate remains the publication check.
This task authorizes no deployment.
