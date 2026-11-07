"""Small, model-free fixture executions for test/audio-scripts.test.ts.

The golden JSON was captured from pre-S15g nalati_score.cmd_rank and sfx_merge.merge_ph,
with preview encoding/sprite packing replaced by fixture sizes/no-op. No generated audio is needed.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent
REPO = FIXTURE.parents[2]
SCRIPTS = REPO / "scripts/music/gen"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sandbox(root: Path) -> Path:
    here = root / "scripts/music/gen"
    here.mkdir(parents=True)
    for name in ("own_score.py", "audio_jobs.py", "sfx_build.py", "sfx_merge.py", "sfx_sprite.py", "nd_page.py",
                 "ph_page.py", "build_page.py", "nalati-jobs.json", "nd-score-jobs.json", "sfx-nd-jobs.json"):
        shutil.copy2(SCRIPTS / name, here / name)
    return here


def metrics(voice: float = 0.02, prob: float = 0.7, seam: float = 0.6) -> dict:
    return {"vocals": {"vocal_energy_share": voice, "groove_active_frac": 0.8, "drums_active_frac": 0.75},
            "kazakh": {"kazakh_prob": prob, "instrument_prob": {"dombra": 0.3, "kobyz": 0.2, "sybyzgy": 0.1, "throat": 0.1}},
            "loop": {"score": seam}, "clipping": {"clipped_frac": 0},
            "silence": {"longest_internal_gap_s": 0, "tail_silence_s": 0}, "spectrum": {"rolloff95_hz": 12000},
            "duration_s": 75, "tempo": {"estimated_bpm": 84}, "loudness": {"lufs": -18, "true_peak_dbfs": -2}}


def score_fixture(root: Path, group: str = "nalati") -> tuple[Path, Path]:
    raw, art = root / "raw", root / "art/music/round-4-nalati"
    slots = ("grass", "sky", "snow", "night", "storm", "king") if group == "nalati" else ("nd-market", "nd-well", "nd-fight")
    names = [(f"{group}-{s}", s) for s in slots]
    if group == "nalati":
        names.append(("test-dombra", "test/dombra"))
    for folder, slot in names:
        d = raw / folder
        d.mkdir(parents=True)
        for seed, voice, prob, seam in ((1, 0.02, 0.7, 0.6), (2, 0.15, 0.8, 0.4), (3, 0.25, 0.3, 0.7), (4, 0.65, 0.9, 0.7)):
            side = {"seed": seed, "gen_time_s": 1, "prompt": "fixture", "lyrics": "[Instrumental]", "steps": 30}
            (d / f"minimax3-{seed}.json").write_text(json.dumps(side))
            m = metrics(voice, prob, seam)
            if group == "nd":
                m["instruments"] = {"instrument_prob_total": prob, "instrument_prob": {"guzheng": 0.4, "erhu": 0.2, "pad": 0.1}}
            (d / f"minimax3-{seed}.metrics.json").write_text(json.dumps(m))
            # Dry rank reads only these sizes; WAV and encoded data are deliberately absent.
            name = f"dombra-{seed}.m4a" if slot == "test/dombra" else f"{slot}-{seed}.{'m4a' if group == 'nalati' else 'mp3'}"
            dest = art / ("test" if slot.startswith("test/") else slot) / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(bytes(100 + seed))
    return raw, art


def merge_fixture(root: Path, here: Path, set_name: str = "pine-hollow", tag: str = "ph") -> tuple[dict, dict, dict, Path]:
    sfx = root / "public/assets/sfx"
    best = sfx / "best"
    best.mkdir(parents=True)
    man = {"model": "both", "credit": "credit", "licence": "fixture", "beds": {}, "hums": {}, "oneshots": {}, "provenance": [], "synth_keeps": ["old"]}
    (best / "sfx.json").write_text(json.dumps(man, indent=2, ensure_ascii=False) + "\n")
    table = {"old": {"winner": "moss"}, "keep": {"winner": "moss", "round": "round-2"}}
    (here / "sfx-best.json").write_text(json.dumps({"rule": "fixture", "wins": {}, "families": table}, indent=2) + "\n")
    bed = "bed-market" if set_name == "pine-hollow" else "bed.nd.market"
    hum = "hum-lantern" if set_name == "pine-hollow" else "hum.lantern"
    fams = {"shot": {"kind": "oneshot", "into": set_name}, "tie": {"kind": "oneshot", "into": set_name},
            "skip": {"kind": "oneshot", "into": set_name}, "keep": {"kind": "oneshot", "into": "best"},
            "missing": {"kind": "oneshot", "into": set_name}, bed: {"kind": "bed", "into": set_name, "zone": "market", "live": True},
            hum: {"kind": "hum", "into": set_name}, "global": {"kind": "oneshot", "into": "best"}}
    if tag == "nd":
        fams.pop("keep")
        fams.pop("global")
    for job in fams.values():
        job.update(duration=1, desc="fixture", prompt="fixture")
    (here / "sfx-fixture-jobs.json").write_text(json.dumps({"families": fams}))
    stage, sets, ranking = root / "stage", {}, {}
    for model in ("moss", "sa3-medium"):
        d = stage / model
        d.mkdir(parents=True)
        sm = {"beds": {}, "hums": {}, "oneshots": {}, "provenance": []}
        rows = {}
        for fam, job in fams.items():
            if fam == "missing" and model == "sa3-medium":
                continue
            rank = 6 if fam in ("skip", "keep") else (1 if model == "moss" else 2)
            if fam == "tie":
                rank = 1
            p = 0.7 if model == "moss" else 0.9
            rows[fam] = [{"rank": rank, "p": p, "seed": 1}]
            if rank > 5:
                continue
            filename = f"{fam}-{model}.m4a"
            (d / filename).write_bytes(b"fixture")
            sm["provenance"].append({"file": filename, "clap_rank": rank, "clap_p": p, "seed": 1})
            if job["kind"] == "oneshot":
                sm["oneshots"][fam] = {"files": [filename], "gain": 1}
            else:
                key = fam.split("-", 1)[1] if "-" in fam else fam.split(".", 1)[1]
                sm["beds" if job["kind"] == "bed" else "hums"][key] = {"file": filename, "loopStart": 0, "loopEnd": 1, "duration": 1, "gain": 0.5}
        (d / "sfx.json").write_text(json.dumps(sm))
        (here / f"sfx-{tag}-{model}.json").write_text(json.dumps({"model": model, "families": rows}, indent=2) + "\n")
        sets[model], ranking[model] = sm, rows
    return fams, sets, ranking, stage


def closures(fams: dict, sets: dict, ranking: dict):
    def entry(model, family):
        kind = fams[family]["kind"]
        if kind == "oneshot":
            e = sets[model]["oneshots"].get(family)
            return e, e["files"] if e else []
        key = family.split("-", 1)[1] if "-" in family else family.split(".", 1)[1]
        e = sets[model]["beds" if kind == "bed" else "hums"].get(key)
        return e, [e["file"]] if e else []

    def score(model, family):
        row = ranking[model][family][0]
        return row["rank"], row["p"]
    return entry, score


def run(case: str) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp).resolve()
        here = sandbox(root)
        if case in ("nalati", "nd-score"):
            raw, art = score_fixture(root, "nalati" if case == "nalati" else "nd")
            args = [sys.executable, str(here / "own_score.py"), "rank", str(raw), "--dry", "--art", str(art)]
            if case == "nd-score":
                args += ["--set", "nine-dragon-stack"]
            before = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            out = subprocess.run(args, capture_output=True, text=True, check=True).stdout
            after = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts}
            before = {k: v for k, v in before.items() if "__pycache__" not in Path(k).parts}
            assert before == after, "dry rank changed files"
            return out
        if case in ("pine-merge", "nd-merge", "nd-merge-write"):
            set_name, tag = ("pine-hollow", "ph") if case == "pine-merge" else ("nine-dragon-stack", "nd")
            fams, sets, ranking, stage = merge_fixture(root, here, set_name, tag)
            if case == "nd-merge-write":
                # Encoding is separate; real merge writes exercise the shared-ledger regression without codecs/models.
                (here / "sfx_sprite.py").write_text("def run(*args, **kwargs): pass\n")
                shared = [root / "public/assets/sfx/best/sfx.json", here / "sfx-best.json"]
                frozen = [p.read_bytes() for p in shared]
                args = [sys.executable, str(here / "sfx_merge.py"), "--jobs", "sfx-fixture-jobs.json", "--stage", str(stage), "--tag", tag]
                subprocess.run(args, capture_output=True, text=True, check=True)
                assert frozen == [p.read_bytes() for p in shared], "own merge changed shared set"
                subprocess.run(args + ["--only", "shot"], capture_output=True, text=True, check=True)
                assert frozen == [p.read_bytes() for p in shared], "partial own merge changed shared set"
                return json.dumps({"unchanged": True, "table": json.loads((here / "sfx-nd-best.json").read_text())})
            before = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            out = subprocess.run([sys.executable, str(here / "sfx_merge.py"), "--jobs", "sfx-fixture-jobs.json",
                                  "--stage", str(stage), "--tag", tag, "--dry"], capture_output=True, text=True, check=True).stdout
            after = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts}
            assert before == after, "dry merge changed files"
            return json.dumps({str(Path(k).relative_to(root)): v for k, v in json.loads(out).items()}, indent=2, ensure_ascii=False) + "\n"
        if case == "nd-page":
            music, sfx = root / "public/assets/music/nine-dragon-stack", root / "public/assets/sfx/nine-dragon-stack"
            music.mkdir(parents=True)
            sfx.mkdir(parents=True)
            man = {"slots": {}, "stings": {}, "provenance": []}
            score = {"slots": {}}
            raw, sfx_raw = root / "raw", root / "sfx-raw"
            for slot in ("nd-market", "nd-well", "nd-fight"):
                man["slots"][slot] = {"calm": f"{slot}-calm.m4a", "tension": f"{slot}-tension.m4a", "loopStart": 0.1, "loopEnd": 1.1, "bpm": 84}
                for part in ("calm", "tension"):
                    (music / f"{slot}-{part}.m4a").touch()
                # The shipped pick is rank 2 (an ear pick); rank 1 must become the alternate.
                man["provenance"].append({"file": f"{slot}-calm.m4a", "take": "minimax3-2"})
                score["slots"][slot] = {"pick": "minimax3-1", "takes": [{"id": f"minimax3-{i}", "rank": i, "side": {"seed": i}, "score": 0.7} for i in (1, 2)]}
                (raw / f"nd-{slot}").mkdir(parents=True)
                (raw / f"nd-{slot}/minimax3-1.wav").touch()
            for sting in ("pickup", "death", "chunk"):
                man["stings"][sting] = f"{sting}.m4a"
                (music / f"{sting}.m4a").touch()
            (music / "music.json").write_text(json.dumps(man))
            (here / "nd-score.json").write_text(json.dumps(score))
            beds = {}
            for name in ("nd.market", "nd.well"):
                beds[name] = {"file": f"{name}.m4a", "loopStart": 0.1, "loopEnd": 1.1}
                (sfx / f"{name}.m4a").touch()
            (sfx / "sfx.json").write_text(json.dumps({"beds": beds}))
            families = json.loads((here / "sfx-nd-jobs.json").read_text())["families"]
            rank = {f: [{"seed": 1, "rank": 1, "p": 0.8}] for f in families}
            for model, folder in (("moss", "moss"), ("sa3-medium", "medium")):
                (here / f"sfx-nd-{model}.json").write_text(json.dumps({"families": rank}))
                for fam in families:
                    (sfx_raw / folder / fam).mkdir(parents=True)
                    (sfx_raw / folder / fam / "1.wav").touch()
            (here / "sfx-best.json").write_text(json.dumps({"families": {f: {"winner": "moss"} for f in families}}))
            out = subprocess.run([sys.executable, str(here / "nd_page.py"), str(raw), str(sfx_raw), "--out", str(root / "artifact"), "--dry"],
                                 capture_output=True, text=True, check=True).stdout
            assert not (root / "artifact").exists(), "dry board wrote files"
            return out
        raise ValueError(case)


if __name__ == "__main__":
    print(run(sys.argv[1]), end="")
