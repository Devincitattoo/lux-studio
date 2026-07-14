#!/usr/bin/env python3
"""Generate short AI video clips from normalized listing photos using Venice."""
import base64
import json
import os
import time
from pathlib import Path

import requests

try:
    import lux_bridge as _bridge
    _BRIDGE = True
except Exception:
    _BRIDGE = False

ROOT = Path(__file__).resolve().parent.parent
LISTING_ID = os.environ.get("LISTING_ID", "774150286785033892")
NORM_DIR = ROOT / "video-output" / LISTING_ID / "normalized"
CLIP_DIR = ROOT / "video-output" / LISTING_ID / "clips"
API_BASE = "https://api.venice.ai/api/v1"


def load_env():
    env_path = ROOT / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v)


def encode_image(path):
    with open(path, "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


def queue_video(api_key, model, prompt, image_url, duration, resolution):
    url = f"{API_BASE}/video/queue"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "prompt": prompt,
        "image_url": image_url,
        "duration": duration,
        "resolution": resolution,
    }
    r = requests.post(url, headers=headers, json=payload, timeout=60)
    r.raise_for_status()
    return r.json()


def retrieve_video(api_key, model, queue_id):
    url = f"{API_BASE}/video/retrieve"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "queue_id": queue_id}
    r = requests.post(url, headers=headers, json=payload, timeout=120)
    r.raise_for_status()
    ct = r.headers.get("Content-Type", "")
    if ct.startswith("video/"):
        return {"status": "COMPLETED", "_binary": r.content}
    try:
        data = r.json()
        data["_binary"] = None
        return data
    except Exception:
        # Empty or unexpected body; treat as still processing
        return {"status": "PROCESSING", "_binary": None}


def download_clip(result, dest):
    if result.get("_binary"):
        data = result["_binary"]
        with open(dest, "wb") as f:
            f.write(data)
        return len(data)
    if "download_url" in result and result["download_url"]:
        r = requests.get(result["download_url"], timeout=120)
        r.raise_for_status()
        with open(dest, "wb") as f:
            f.write(r.content)
        return len(r.content)
    content_type = result.get("content_type", "")
    if "video" in content_type or result.get("video"):
        data = result.get("video") or result.get("data")
        if isinstance(data, str):
            data = base64.b64decode(data)
        with open(dest, "wb") as f:
            f.write(data)
        return len(data)
    raise ValueError(f"No download_url or video data in result: {list(result.keys())}")


def main():
    load_env()
    api_key = os.environ["VENICE_API_KEY"]
    model = os.environ.get("VIDEO_MODEL", "seedance-2-0-image-to-video")
    duration = os.environ.get("VIDEO_DURATION", "5s")
    resolution = os.environ.get("VIDEO_RESOLUTION", "720p")

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = NORM_DIR / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)

    indices_str = os.environ.get("PHOTO_INDICES", "")
    if indices_str:
        indices = [int(x.strip()) for x in indices_str.split(",") if x.strip()]
    else:
        indices = [min(i, len(manifest)) for i in [1, 2, 8, 14, 28]]

    prompts = {
        1: "Slow cinematic push-in across a luxury bedroom at night, city lights twinkling through floor-to-ceiling windows, warm ambient interior lighting, smooth camera motion.",
        2: "Smooth camera drift through a modern hillside living room, revealing panoramic green canyon views through glass walls, golden natural light.",
        8: "Slow aerial-style glide above the sofa toward sweeping floor-to-ceiling windows, lush canyon and a distant city skyline beyond.",
        14: "Cinematic push-in through a serene master suite, a glass-walled spa bathroom and private balcony visible, soft daylight.",
        28: "Cinematic drone flyover approaching a modern glass Beverly Hills mansion at dusk, trees and hillside surrounding the architecture, gentle reveal.",
    }

    quote_body = {"model": model, "duration": duration, "resolution": resolution}
    qr = requests.post(
        f"{API_BASE}/video/quote",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=quote_body,
        timeout=30,
    )
    quote = qr.json().get("quote")
    print(f"Model: {model} | Duration: {duration} | Resolution: {resolution}")
    print(f"Quote per clip: ${quote} | Clips to generate: {len(indices)} | Estimated total: ${quote * len(indices)}")

    # Load existing manifest if present
    clip_manifest_path = CLIP_DIR / "manifest.json"
    results = []
    if clip_manifest_path.exists():
        with open(clip_manifest_path) as f:
            results = json.load(f)

    for item in manifest:
        idx = item["index"]
        if idx not in indices:
            continue
        dest = CLIP_DIR / f"clip_{idx:03d}.mp4"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"\n[{idx}] Skipping — {dest.name} already exists")
            if not any(r["index"] == idx for r in results):
                results.append({"index": idx, "queue_id": None, "file": str(dest), "prompt": prompts.get(idx, "")})
            continue

        norm_path = Path(item["normalized"])
        prompt = prompts.get(idx, "Cinematic smooth camera motion, high-end real estate aesthetic, gentle reveal.")
        print(f"\n[{idx}] Queuing clip for {norm_path.name}...")
        print(f"    prompt: {prompt}")
        image_url = encode_image(norm_path)
        queued = queue_video(api_key, model, prompt, image_url, duration, resolution)
        queue_id = queued["queue_id"]
        print(f"    queue_id: {queue_id}")

        job_id = None
        if _BRIDGE:
            job_id = _bridge.record_video_job(LISTING_ID, idx, status='queued', cost=quote, queue_id=queue_id, file_path=str(dest))

        start = time.time()
        while True:
            time.sleep(10)
            result = retrieve_video(api_key, model, queue_id)
            status = result.get("status", "UNKNOWN")
            elapsed = int(time.time() - start)
            print(f"    [{elapsed}s] status: {status}")
            if status == "COMPLETED":
                size = download_clip(result, dest)
                print(f"    Saved {dest.name} ({size} bytes)")
                results.append({"index": idx, "queue_id": queue_id, "file": str(dest), "prompt": prompt})
                if _BRIDGE and job_id:
                    _bridge.update_video_job_status(job_id, 'completed', file_path=str(dest))
                break
            if status in ("FAILED", "ERROR"):
                print(f"    FAILED: {result}")
                if _BRIDGE and job_id:
                    _bridge.update_video_job_status(job_id, 'failed')
                break

    with open(clip_manifest_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nGenerated {len(results)} clips in {CLIP_DIR}")


if __name__ == "__main__":
    main()
