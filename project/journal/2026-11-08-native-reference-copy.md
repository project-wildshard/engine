# Copy the reconstructed native prefix in bulk

Internal LZ references used a JavaScript loop for every native byte. The
decoder now copies only an already reconstructed span, then doubles the
span until the same reference is complete. Each source ends at or before
the target, including distance-one overlap. All original token, distance,
length, allocation and basis checks precede copying unchanged. The wire
encoder and every byte pin are untouched.

Thirty-six alternating pairs use actual Nalati snapshots at ticks 0, 120
and 240, based and unbased, with 21.9–22.1 MB of complete native bytes.
Every byte and metadata field match. Raw reconstruction totals fall from
98.28 to 40.48 ms; median paired saving is 2.26 ms. Complete strict wire
decode totals are 3,298.46 versus 3,121.83 ms, median saving 3.33 ms with
23 of 36 positive pairs. This is a small kernel gain, not the missing
three-minute full-suite result. Object-admission work remains the larger
HS4 seam handed to pinefix2.
