# Nine's non-placement JSON and Valibot (STR32)

> Written by: Codex (codex-tc48)
>
> **State:** measured 2026-11-19, engine main `b388dcff`, Nine r3
> `afd68ee2`. Probe patches ran in a scratch build.

The cooked index lists 44 JSON sections and 60 non-placement JSON blobs,
2,483,143 decoded bytes in total. The original study counted 117 documents
on an earlier product. Nine placement pages are separate. IP31's sampled
108 MB covered their JSON, guard and Valibot allocations together.

The control and three probe arms used the same production-mode build
`b388dcff-mwndlj4j` and exact pin. The validation arm bypassed Valibot only
for marked non-placement cooked inputs. The lazy arm deferred verified
section decoding and speculative non-placement JSON reads until needed.
The combined arm enabled both. All four arms kept normal placement-page
parsing and validation and used the shipped phone Low defaults.

Native WebKit ran online against a signed loopback cell, with minimal
instrumentation and a fresh browser per boot. Each pair held the shared
`engine/tmp/mini-measure.lock` and alternated order. Settled [K] adds
WebContent and GPU after two collections and the idle wait. Loading [K]
uses the largest combined kernel sample before control. Positive
deltas mean the probe used less memory.

Chromium sampled the JS heap through control at 32 KiB, with collected
objects included. Stack attribution charged placement decoding, guards
and schema calls to the placement path first. Non-placement Valibot
includes all other Valibot stacks, including schemas outside cooked
documents. The JSON reader count uses known decode call sites for the
sections, named JSON, scene recipes, model catalogue and graph files.
The graph validator has a separate stack bucket. These allocation
estimates [S] include transient objects.

Probe source, raw pairs, profiles and summary scripts are in
`~/.cache/wildshard/plan-artifacts/engine-memory/str32-2026-11-19/`.

## Sampled allocations

Three Chromium pairs reached control. Values are medians with the
observed range across three boots per arm, in decimal MB [S].

| Attributed stack | Normal | Skip non-placement Valibot |
| --- | ---: | ---: |
| Placement JSON, guards and schemas | 118.77 (117.98–121.23) | 119.76 (117.65–120.96) |
| Other JSON readers | 13.70 (13.49–14.46) | 14.89 (13.15–14.91) |
| Other Valibot | 51.83 (50.52–52.59) | 32.62 (32.42–34.90) |
| Material graph validation outside Valibot stacks | 54.16 (48.64–54.91) | 54.72 (53.24–55.46) |

The bypass removed 18.10 MB [S] of non-placement Valibot allocations by
paired median (17.69–19.21 MB). Placement allocation differed by less
than 2 MB [S] in each pair.

## Kernel footprint

Six locked cold pairs per arm, 36 boots in all, reached control without
page errors. Values are paired median savings with ranges in decimal MB.

| Probe | Settled [K] | Loading peak [K] | Lower peak |
| --- | ---: | ---: | ---: |
| Skip non-placement Valibot | −0.90 (−16.15 to 10.35) | 13.16 (−62.13 to 58.38) | 4/6 |
| Lazy non-placement JSON | 1.74 (−28.75 to 21.82) | 29.42 (−36.32 to 108.82) | 4/6 |
| Both | 0.88 (−12.22 to 20.89) | −6.46 (−91.91 to 59.02) | 2/6 |

The lazy path deferred 13 initial named reads (482,739 B) and recorded
seven scene reads at demand. It performed 186 tagged decodes before
control against 193 on the reference arm. The validation arm bypassed
50 calls on tagged inputs. The reference observed 34 tagged calls
because reconstructed schema outputs lose the input tag.

STR34's go line was 30 MB settled or a lower peak in five of six pairs.
The validation arm stayed below it. The combined arm missed the 50 MB
threshold for a binary-format row.
