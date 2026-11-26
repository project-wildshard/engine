"""Trailer sound design: CLAP-rank every take of a families file (MOSS-SoundEffect v2 + Stable Audio 3 Medium) and keep
the better take per family (docs/trailer.md). Restored from singleplayer scripts/steam-trailer/sfx_pick.py (cf104912d3^).

    ~/ml/music/analysis/.venv/bin/python src/scripts/trailer/sfx_pick.py --jobs src/scripts/trailer/sfx-jobs.json \
        --raw <sfx raw dir> --out <best dir>

The CLAP model and helpers come from sharddev's audio tools (packages/sdk/scripts/music/gen/analyze.py); WS_MUSIC_GEN
names another copy of that folder.

<raw>/<model>/<family>/<seed>.wav + .json come from gen_sfx_moss.py (model `moss`) and gen_sfx.py --model medium (`medium`).
Same scoring as scripts/music/gen/sfx_build.py: laion/clap-htsat-fused, the take (mono, 48 kHz, 10 s chunks averaged)
against every family's `desc` + three foils; p = softmax share (the model's logit scale) of its own desc, rank = 1 + the
number of texts scoring higher. Winner = lowest rank, ties -> higher p; alt = the runner-up by the same key.
Writes <out>/<family>.wav (48 kHz, 24-bit, leading silence trimmed), <out>/<family>-alt.wav, <out>/picks.json and
<out>/ranking.json. The mix (mix.py) reads <out>/tr-<family>.wav as `tr:<family>` with `sfxdir` = <out>.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch
from transformers import ClapModel, ClapProcessor

GEN = Path(os.environ.get("WS_MUSIC_GEN", Path(__file__).resolve().parents[4] / "sharddev/packages/sdk/scripts/music/gen"))
sys.path.insert(0, str(GEN))
from analyze import CLAP_DIR, _tensor  # noqa: E402

FOILS = ["music with melody and instruments", "a person speaking", "silence"]
MODELS = {"moss": "MOSS-SoundEffect v2.0", "medium": "Stable Audio 3 Medium"}
SR = 48000


def prep(path: Path, bed: bool) -> tuple[np.ndarray, dict]:
    """48 kHz; a one-shot's leading silence trimmed (onset -45 dB re peak, 5 ms pre-roll) and trailing silence trimmed
    (-60 dB + 50 ms tail, 30 ms fade); a bed is kept whole (a 30 ms fade each end). Returns (channels x samples, info)."""
    x, sr = sf.read(str(path), always_2d=True)
    x = x.T.astype(np.float32)
    if sr != SR:
        x = librosa.resample(x, orig_sr=sr, target_sr=SR, res_type="soxr_hq")
    env = np.abs(x).max(0)
    pk = float(env.max())
    a, b = 0, x.shape[1]
    if not bed:
        on = np.where(env > pk * 10 ** (-45 / 20))[0]
        tail = np.where(env > pk * 10 ** (-60 / 20))[0]
        a = max(int(on[0]) - int(0.005 * SR), 0)
        b = min(int(tail[-1]) + int(0.05 * SR), x.shape[1])
    y = x[:, a:b].copy()
    nin, nout = int((0.03 if bed else 0.001) * SR), min(int(0.03 * SR), y.shape[1] // 4)
    y[:, :nin] *= np.linspace(0.0, 1.0, nin)[None]
    y[:, -nout:] *= np.linspace(1.0, 0.0, nout)[None]
    mono = np.abs(y).max(0)
    hop = int(0.01 * SR)
    rms = librosa.feature.rms(y=y.mean(0), frame_length=int(0.02 * SR), hop_length=hop, center=True)[0]
    onset = np.where(mono > float(mono.max()) * 10 ** (-45 / 20))[0]
    info = {"duration_s": round(y.shape[1] / SR, 3), "peak_s": round(float(rms.argmax()) * hop / SR, 3),
            "sample_peak_s": round(float(mono.argmax()) / SR, 3), "onset_ms": round(float(onset[0]) / SR * 1000, 1),
            "peak_dbfs": round(float(20 * np.log10(max(float(mono.max()), 1e-9))), 1),
            "trimmed_lead_s": round(a / SR, 3), "channels": y.shape[0], "source_sr": sr}
    return y, info


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True, help="the families file (sfx-jobs.json shape)")
    ap.add_argument("--raw", required=True, help="<raw>/<model>/<family>/<seed>.wav")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    fams = json.loads(Path(args.jobs).read_text())["families"]
    names = list(fams)
    texts = [fams[f]["desc"] for f in names] + FOILS
    clap = ClapModel.from_pretrained(str(CLAP_DIR)).eval()
    proc = ClapProcessor.from_pretrained(str(CLAP_DIR))
    scale = float(clap.logit_scale_a.detach().exp())
    with torch.no_grad():
        te = torch.nn.functional.normalize(_tensor(clap.get_text_features(**proc(text=texts, return_tensors="pt", padding=True))), dim=-1)

    raw, best = Path(args.raw), Path(args.out)
    takes: dict[str, list[dict]] = {f: [] for f in names}
    for model in MODELS:
        for wav in sorted((raw / model).glob("*/*.wav")):
            side = json.loads(wav.with_suffix(".json").read_text())
            fam = side["family"]
            if fam not in takes:
                continue
            x, sr = sf.read(str(wav), always_2d=True)
            y48 = librosa.resample(x.mean(1).astype(np.float32), orig_sr=sr, target_sr=SR)
            seg = SR * 10
            chunks = [y48[i:i + seg] for i in range(0, max(len(y48) - seg // 2, 1), seg)] or [y48]
            with torch.no_grad():
                a = proc(audio=chunks, sampling_rate=SR, return_tensors="pt")
                ae = torch.nn.functional.normalize(_tensor(clap.get_audio_features(**a)), dim=-1).mean(0, keepdim=True)
                sims = (torch.nn.functional.normalize(ae, dim=-1) @ te.T)[0]
            i = names.index(fam)
            takes[fam].append({"model": model, "seed": side["seed"], "wav": str(wav), "gen_time_s": side.get("gen_time_s"),
                               "clap_p": round(float(torch.softmax(sims * scale, 0)[i]), 3),
                               "clap_rank": int((sims > sims[i]).sum()) + 1, "best_match": texts[int(sims.argmax())]})

    best.mkdir(parents=True, exist_ok=True)
    picks, table = {}, {}
    for fam in names:
        rs = sorted(takes[fam], key=lambda r: (r["clap_rank"], -r["clap_p"]))
        table[fam] = rs
        if not rs:
            print(f"{fam:16s} no takes", flush=True)
            continue
        bed = fams[fam].get("kind") in ("bed", "hum")
        for r, suffix in ((rs[0], ""), (rs[1] if len(rs) > 1 else None, "-alt")):
            if r is None:
                continue
            y, info = prep(Path(r["wav"]), bed)
            out = best / f"{fam if fam.startswith('tr-') else 'tr-' + fam}{suffix}.wav"
            sf.write(str(out), y.T, SR, subtype="PCM_24")
            row = {"model": MODELS[r["model"]], "seed": r["seed"], "clap_rank": r["clap_rank"], "clap_p": r["clap_p"],
                   **info, "best_match": r["best_match"], "raw": r["wav"], "file": out.name}
            if suffix:
                picks[fam]["alt"] = row
            else:
                picks[fam] = row
        by_model = {m: min(((t["clap_rank"], -t["clap_p"]) for t in rs if t["model"] == m), default=None) for m in MODELS}
        picks[fam]["per_model_best"] = {MODELS[m]: ({"rank": v[0], "p": -v[1]} if v else None) for m, v in by_model.items()}
        alt = picks[fam].get("alt", {})
        print(f"{fam:16s} {picks[fam]['model']:24s} seed {picks[fam]['seed']} rank {picks[fam]['clap_rank']} p {picks[fam]['clap_p']:.3f} "
              f"dur {picks[fam]['duration_s']}s peak {picks[fam]['peak_s']}s | alt {alt.get('model')} seed {alt.get('seed')} "
              f"rank {alt.get('clap_rank')}", flush=True)
    note = {"_doc": f"Trailer SFX picks for {Path(args.jobs).name}. Winner = lowest CLAP rank among the takes (MOSS + SA3 Medium), "
                    f"ties -> higher CLAP p; alt = runner-up. CLAP laion/clap-htsat-fused vs the {len(names)} family descs + "
                    f"{len(FOILS)} foils. Files 48 kHz 24-bit; a one-shot's leading silence trimmed (onset -45 dB re peak, "
                    "<=5 ms pre-roll); peak_s = loudest 20 ms RMS frame, sample_peak_s = loudest sample, both from the file start."}
    (best / "picks.json").write_text(json.dumps(picks, indent=2) + "\n")
    (best / "ranking.json").write_text(json.dumps({**note, **table}, indent=2) + "\n")


if __name__ == "__main__":
    main()
