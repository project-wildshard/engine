"""Scan trailer score takes (docs/trailer.md; restored from singleplayer scripts/steam-trailer/music_scan.py) — length, tempo, beat grid, loudness curve (1 s bins, dB) and the biggest hits —
so the cut can be laid on the music. ~/ml/music/analysis/.venv/bin/python src/scripts/trailer/music_scan.py <wav>..."""
import json
import sys

import librosa
import numpy as np

for path in sys.argv[1:]:
    y, sr = librosa.load(path, sr=48000, mono=True)
    dur = len(y) / sr
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
    bt = librosa.frames_to_time(beats, sr=sr, hop_length=512)
    rms = librosa.feature.rms(y=y, frame_length=4096, hop_length=480)[0]
    t = np.arange(len(rms)) * 480 / sr
    bins = [float(20 * np.log10(rms[(t >= s) & (t < s + 1)].mean() + 1e-9)) for s in range(int(dur))]
    on = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    ot = librosa.frames_to_time(np.arange(len(on)), sr=sr, hop_length=512)
    top = np.argsort(on)[::-1]
    hits = []
    for i in top:
        if all(abs(ot[i] - h) > 1.5 for h in hits):
            hits.append(float(ot[i]))
        if len(hits) >= 8:
            break
    print(json.dumps({
        "file": path.split("/")[-1], "dur": round(dur, 2), "bpm": round(float(np.atleast_1d(tempo)[0]), 1),
        "first_beats": [round(float(b), 2) for b in bt[:6]],
        "db_per_s": " ".join(f"{int(round(b))}" for b in bins),
        "hits": sorted(round(h, 2) for h in hits),
    }))
