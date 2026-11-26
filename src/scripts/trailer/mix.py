"""The trailer mix (docs/trailer.md), restored from singleplayer scripts/steam-trailer/mix.py (cf104912d3^). Score + zone
ambience beds + the game's own sound effects on the picture's events +
the trailer's sound-design hits, summed at 48 kHz stereo, then loudness-normalised (ffmpeg loudnorm, two-pass,
-14 LUFS integrated, -1 dBTP: web-trailer loudness).

    ~/ml/music/analysis/.venv/bin/python src/scripts/trailer/mix.py <mix.json> <out.wav>

mix.json:
  length        seconds
  music         { file, segments: [[src_in, src_out, at], ...], gain_db, fades: [[at, dur, "in"|"out"], ...] }
  beds          [{ sound, at, dur, gain_db, fade }]           looped / trimmed; `sound` as below
  events        [{ sound, at, gain_db, pan?, peak? }]         `peak`: align this many s into the sound to `at` (a riser's top)
  duck          [{ at, dur, db }]                              dips the music under a moment (a roar, the silence before a hit)
`sound` is  game:<name>  (engine public/assets/sfx/**/<name>-<n>-<hash>.m4a, the n-th take by `take`, else the first),  tr:<family>  (the
trailer set, <sfxdir>/tr-<family>.wav) or a path.
"""
from __future__ import annotations

import glob
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

REPO = Path(__file__).resolve().parents[3]
SR = 48000


def decode(path: str) -> np.ndarray:
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, 2).copy()


def resolve(sound: str, take: int | None, sfxdir: str) -> str:
    if sound.startswith("game:"):
        pre = sound[5:]
        # the game's sound set: <name>-<take>-<8 hex>.m4a under public/assets/sfx/ (best/ first, then a zone's own)
        pat = re.compile(rf"^{re.escape(pre)}-(\d+)-[0-9a-f]{{8}}\.m4a$")
        hits = sorted(glob.glob(str(REPO / "public/assets/sfx/best/*.m4a"))) + sorted(glob.glob(str(REPO / "public/assets/sfx/*/*.m4a")))
        hits = [h for h in hits if pat.match(Path(h).name)]
        if not hits:
            raise SystemExit(f"no game sound {pre}")
        return hits[min(take or 0, len(hits) - 1)]
    if sound.startswith("tr:"):
        return f"{sfxdir}/tr-{sound[3:]}.wav"
    return sound


def db(x: float) -> float:
    return 10 ** (x / 20)


def place(bus: np.ndarray, x: np.ndarray, at: float, gain: float, pan: float = 0.0) -> None:
    i = int(round(at * SR))
    if i < 0:
        x, i = x[-i:], 0
    n = min(len(x), len(bus) - i)
    if n <= 0:
        return
    l, r = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2), np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    bus[i:i + n, 0] += x[:n, 0] * gain * l
    bus[i:i + n, 1] += x[:n, 1] * gain * r


def ramp(n: int, up: bool) -> np.ndarray:
    k = np.linspace(0, 1, n) if up else np.linspace(1, 0, n)
    return (np.sin(k * np.pi / 2) ** 2)[:, None]  # equal-power-ish


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text())
    out = sys.argv[2]
    sfxdir = spec.get("sfxdir", "")
    L = int(round(spec["length"] * SR))
    music = np.zeros((L, 2), np.float32)
    fx = np.zeros((L, 2), np.float32)
    beds = np.zeros((L, 2), np.float32)

    # score: segments spliced with 25 ms equal-power crossfades at the joins
    m = spec["music"]
    src = decode(m["file"])
    xf = int(0.025 * SR)
    for k, (a, b, at) in enumerate(m["segments"]):
        seg = src[int(a * SR):int(b * SR)].copy()
        if k > 0:
            seg[:xf] *= ramp(xf, True)
        if k < len(m["segments"]) - 1:
            seg = np.concatenate([seg, src[int(b * SR):int(b * SR) + xf] * ramp(xf, False)])
        place(music, seg, at, db(m.get("gain_db", 0)))
    for at, dur, kind in m.get("fades", []):
        i, n = int(at * SR), int(dur * SR)
        g = ramp(n, kind == "in")
        music[i:i + n] *= g[: len(music[i:i + n])]
        if kind == "out":
            music[i + n:] = 0
    env = np.ones(L, np.float32)
    for d in spec.get("duck", []):
        i, n, a = int(d["at"] * SR), int(d["dur"] * SR), int(0.08 * SR)
        g = db(d["db"])
        seg = np.full(n, g, np.float32)
        seg[:a] = np.linspace(1, g, a)
        seg[-a:] = np.linspace(g, 1, a)
        env[i:i + n] = np.minimum(env[i:i + n], seg[: len(env[i:i + n])])
    music *= env[:, None]

    for b in spec.get("beds", []):
        x = decode(resolve(b["sound"], b.get("take"), sfxdir))
        n = int(b["dur"] * SR)
        reps = int(np.ceil(n / len(x))) + 1
        x = np.concatenate([x] * reps)[:n]
        f = int(b.get("fade", 0.6) * SR)
        x[:f] *= ramp(f, True)
        x[-f:] *= ramp(f, False)
        place(beds, x, b["at"], db(b.get("gain_db", -18)))

    for e in spec.get("events", []):
        path = resolve(e["sound"], e.get("take"), sfxdir)
        if not Path(path).exists():
            print(f"[mix] missing {e['sound']} ({path}) - skipped")
            continue
        x = decode(path)
        if e.get("dur"):
            n = int(e["dur"] * SR)
            x = x[:n].copy()
            f = min(int(0.05 * SR), len(x))
            x[-f:] *= ramp(f, False)
        place(fx, x, e["at"] - e.get("peak", 0.0), db(e.get("gain_db", 0)), e.get("pan", 0.0))

    mix = music + fx + beds
    # a gentle bus glue: soft-clip the few peaks the sum throws before loudnorm does the level
    mix = np.tanh(mix * 0.9) / 0.9
    tmp = out + ".pre.wav"
    sf.write(tmp, mix, SR, subtype="FLOAT")
    # two-pass loudnorm → -14 LUFS / -1 dBTP / LRA 11
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af", "loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    st = json.loads(p.stderr[p.stderr.rindex("{"):p.stderr.rindex("}") + 1])
    af = (f"loudnorm=I=-14:TP=-1.0:LRA=11:measured_I={st['input_i']}:measured_TP={st['input_tp']}:measured_LRA={st['input_lra']}"
          f":measured_thresh={st['input_thresh']}:offset={st['target_offset']}:linear=true,aresample=48000")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-af", af, "-ar", "48000", "-c:a", "pcm_s24le", out], check=True)
    Path(tmp).unlink()
    print(f"[mix] {out}: {spec['length']} s, pre-norm {st['input_i']} LUFS / {st['input_tp']} dBTP")


if __name__ == "__main__":
    main()
