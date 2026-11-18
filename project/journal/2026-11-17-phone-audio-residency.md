# Phone audio residency

> State: EM30 production-preview proof, 2026-11-17.
> Written by: Codex

On Pine Hollow, the phone Low audio ledger dropped from 60.84–61.13 MB to
23.50–23.79 MB across three alternating cold runs. Both builds served Pine's
manifest SHA-256 `c1363d35e8d1e52c31b6b28a2ca22e891eb4bd8322a05f1a0903742b01b20bbd`.
The baseline was `976309fa`; the candidate used `252b7be5` plus this change.

Headless Chromium with ANGLE Metal used a 402 × 874 viewport. A touch
unlocked Web Audio, the Pine score played from its AAC windows, and a
sampled footstep reached a native source. Each capture took the owner ledger
after ten seconds of playback and two garbage collections. The same take
was 29,696 frames at 48 kHz on the baseline and 14,848 frames at 24 kHz
on the candidate. Its duration remained 0.61867 seconds. The deck kept
playing as streamed windows replaced the preroll, with no scheduling
failures or page errors. The quiet candidate also measured 24.44 MB.

The 48 kHz mono Pine sprite held 30.69 MB of decoded PCM. Its 84 declared
takes now retain 6.86 MB of packed mono 24 kHz PCM. Other packed effects
retain another 3.54 MB. Only the selected take becomes a native float
buffer. Desktop effects and ambience loops retain their original sample
format. Music and score share bounded AAC preparation, including layered
decks. Unsupported AAC formats or audio context rates use the original
full-recording player.

The production candidate's session closure measured 4,394,112 raw and
1,358,030 gzip bytes against caps of 4,400,000 and 1,361,500. Engine and game
typechecks and 63 focused tests passed. Raw ledgers and the playback
witness are in `tmp/codex-nalati-m5/em30-pair-*.json`.
