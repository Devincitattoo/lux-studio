#!/usr/bin/env python3
"""Normalize all downloaded listing photos to a consistent 16:9 frame."""
import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LISTING_ID = os.environ.get("LISTING_ID", "774150286785033892")
SRC_DIR = ROOT / "video-output" / LISTING_ID / "sources"
OUT_DIR = ROOT / "video-output" / LISTING_ID / "normalized"
TARGET_W = 1280
TARGET_H = 720


def normalize(path, dest):
    with Image.open(path) as im:
        im = im.convert("RGB")
        src_w, src_h = im.size
        target_ratio = TARGET_W / TARGET_H
        src_ratio = src_w / src_h
        if src_ratio > target_ratio:
            # Too wide: crop width
            new_w = int(src_h * target_ratio)
            left = (src_w - new_w) // 2
            im = im.crop((left, 0, left + new_w, src_h))
        else:
            # Too tall: crop height
            new_h = int(src_w / target_ratio)
            top = (src_h - new_h) // 2
            im = im.crop((0, top, src_w, top + new_h))
        im = im.resize((TARGET_W, TARGET_H), Image.LANCZOS)
        im.save(dest, "JPEG", quality=92)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = SRC_DIR / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)

    out_manifest = []
    for item in manifest:
        src = Path(item["file"])
        dest = OUT_DIR / src.name
        normalize(src, dest)
        out_manifest.append({"index": item["index"], "source": str(src), "normalized": str(dest)})
        print(f"  normalized {src.name} -> {dest.name}")

    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(out_manifest, f, indent=2)
    print(f"Normalized {len(out_manifest)} photos to {TARGET_W}x{TARGET_H} in {OUT_DIR}")


if __name__ == "__main__":
    main()
