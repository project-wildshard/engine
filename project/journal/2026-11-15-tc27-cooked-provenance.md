# Cooked provenance for every Ring 1 product

> Written by: Codex
> **State:** source complete, 2026-11-15; hosted gameplay proof pending.

The blocking boundaries job exercised the cook store for Blender and
Dunes, but Template still used its bundled build. The aggregate fetch
check could also pass with only metadata, or with another head's bytes.

The proof now retires the bundled routes before production
`addStoredShards` attaches all three products. Every individual gameplay
boot must fetch an actual compressed client part, and every fetched key
must belong to that product's cook index. The receipt records those keys
per product as well as the combined inventory. Missing/duplicate product
indexes and an installer that preserves Template refuse qualification.

No runtime, pins, shared nightly code or cook implementation changed.
`node --check scripts/cook-to-play.mjs` passes. The Mac mini does not run
the cook or graphical proof locally; normal branch CI owns that evidence.

Hosted report 43783265173 exposed an independent gating gap: six existing
released-save cases fail (five eagerly read GLBs from server-only slices;
Blender's old-level refusal expectation also disagrees with today's pin),
so Actions skipped cook-to-play entirely. Those cases belong to TC29/33
and are untouched. The report now lets the stored-product proof run once
input setup succeeds, even when another report step fails; cancellation
and failed setup still stop it. No failure is hidden or made green.

J206's workflow review also requires a successful browser-install outcome
before cook-to-play. That step now has its own id and the proof checks
both input and browser setup outcomes, plus cancellation. Actionlint is
clean; the earlier report failure remains unchanged and visible.

Resumed TC27: hosted run 43784812801 reached the actual cook and found a
source mismatch. Ring 1 installs handwritten Template 2 from the frozen
format dependency, while ring-cook read the unrelated catalogue head
under blender-template and expected its tar in the cache. The new shared
ringCookInputs reader follows exactly that existing Ring 1 selection;
Ring 2 retains catalogue inputs. Both the cook and stored-product reader
consume the selected bytes directly, without a new download or producer.
The real format archive is admitted with an empty tar cache in 0.29 s;
missing Ring 2 archives and unselected hashes still refuse. No pins.ts,
consumer pin, cook launch, runtime host, or H1/H4/H5 source changed.

Hosted 43793795141 cooked all three and then caught a real false boot:
Template reached gameplay but requested only discovery, programs and title
images. The authored _template route missed the bare template rows in
both spawn books, falling back to loose files. bookSelection now keeps
exact rows first, then the product alias. The existing public download
case gains that authored route: witnessed red before the fix, green
afterwards. The strengthened proof still requires an actual part.

The cold baseline also stopped at Node file permissions: its private
export linked packages through the outer checkout. It now installs the
same frozen dependencies offline into its own virtual store; production
permissions remain unchanged. These are transport/setup corrections,
not new graphical work. No cook runs locally.

Review confirms exact-row precedence and the private installation. Its
collision-case suggestion is now in the same existing download test: a
distinct bare row cannot override the authored row. The small case checks
selection/routing; the hosted proof must still witness real part bodies.
