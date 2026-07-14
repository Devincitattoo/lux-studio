#!/usr/bin/env python3
"""Stitch generated clips into one continuous flythrough with crossfades."""
import json
import os
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
LISTING_ID = os.environ.get("LISTING_ID", "774150286785033892")
CLIP_DIR = ROOT / "video-output" / LISTING_ID / "clips"
OUT_DIR = ROOT / "video-output" / LISTING_ID
FINAL = OUT_DIR / "flythrough.mp4"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
FADE = 1.0  # seconds


def get_duration(path):
    cmd = [FFMPEG, "-i", str(path)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", r.stderr)
    if not m:
        raise RuntimeError(f"Could not determine duration for {path}")
    h, m_, s = m.groups()
    return int(h) * 3600 + int(m_) * 60 + float(s)


def build_filter_complex(clips, fade):
    n = len(clips)
    if n == 1:
        return "[0:v][0:a]copy[outv][outa]"

    durations = [get_duration(c) for c in clips]
    # Video chain
    chain = ""
    offsets = []
    cum = 0
    for i in range(n - 1):
        cum += durations[i]
        offsets.append(cum - (i + 1) * fade)
    for i in range(n - 1):
        left = f"{i}:v" if i == 0 else f"vt{i}"
        right = f"{i+1}:v"
        out = f"[vt{i+1}]" if i < n - 2 else "[outv]"
        chain += f"[{left}][{right}]xfade=transition=fade:duration={fade}:offset={offsets[i]}{out};"
    # Audio chain
    for i in range(n - 1):
        left = f"{i}:a" if i == 0 else f"at{i}"
        right = f"{i+1}:a"
        out = f"[at{i+1}]" if i < n - 2 else "[outa]"
        chain += f"[{left}][{right}]acrossfade=d={fade}{out};"
    return chain.rstrip(";")


def main():
    manifest_path = CLIP_DIR / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)

    # Default order: exterior dusk -> living -> living view -> master suite -> bedroom night
    default_order = [28, 2, 8, 14, 1]
    order = [int(x.strip()) for x in os.environ.get("CLIP_ORDER", "").split(",") if x.strip()] or default_order

    by_index = {m["index"]: m for m in manifest}
    clips = [Path(by_index[i]["file"]) for i in order if i in by_index]
    if not clips:
        raise SystemExit("No clips to stitch")

    print(f"Stitching {len(clips)} clips in order: {order}")
    filter_complex = build_filter_complex(clips, FADE)
    print("Filter complex:", filter_complex[:200], "...")

    inputs = []
    for c in clips:
        inputs += ["-i", str(c)]

    cmd = [
        FFMPEG,
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-y",
        str(FINAL),
    ]
    print("Running ffmpeg...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FFmpeg stderr:", r.stderr[-2000:])
        raise RuntimeError("Stitching failed")
    print(f"Saved final flythrough: {FINAL} ({FINAL.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
