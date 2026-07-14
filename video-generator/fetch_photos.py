#!/usr/bin/env python3
"""Fetch all listing photos for a scraped Airbnb listing."""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs, urlunparse

import requests

ROOT = Path(__file__).resolve().parent.parent
LISTING_ID = os.environ.get("LISTING_ID", "774150286785033892")
OUT_DIR = ROOT / "video-output" / LISTING_ID / "sources"


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


def load_session():
    session_path = ROOT / "airbnb_getter" / "airbnb_session.json"
    with open(session_path) as f:
        return json.load(f)


def extract_photo_urls(html):
    """Extract unique Airbnb photo URLs in page order."""
    pattern = re.compile(
        r"https://a0\.muscache\.com/im/pictures/[a-f0-9\-]+\.jpg(?:\?[^\"'\s]*)?"
    )
    seen = set()
    urls = []
    for match in pattern.finditer(html):
        url = match.group(0)
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        # Strip sizing params to dedupe; we will request high-res later
        base = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            "",
            "",
            "",
        ))
        if base not in seen:
            seen.add(base)
            urls.append(base)
    return urls


def high_res(url, width=1920):
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}im_w={width}"


def fetch_listing_html(listing_id, session_cookies):
    url = f"https://www.airbnb.com/rooms/{listing_id}"
    s = requests.Session()
    for c in session_cookies:
        s.cookies.set(
            c["name"],
            c["value"],
            domain=c.get("domain"),
            path=c.get("path", "/"),
        )
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    r = s.get(url, headers=headers, timeout=60)
    r.raise_for_status()
    return r.text


def download_photo(url, dest):
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    with open(dest, "wb") as f:
        f.write(r.content)
    return len(r.content)


def main():
    load_env()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Fetching listing {LISTING_ID}...")
    session_cookies = load_session()
    html = fetch_listing_html(LISTING_ID, session_cookies)
    urls = extract_photo_urls(html)
    print(f"Found {len(urls)} unique photos")
    if not urls:
        sys.exit("No photos found")

    manifest = []
    for i, base in enumerate(urls, start=1):
        url = high_res(base, width=1920)
        dest = OUT_DIR / f"photo_{i:03d}.jpg"
        try:
            size = download_photo(url, dest)
            print(f"  [{i}/{len(urls)}] {dest.name} ({size} bytes)")
            manifest.append({"index": i, "url": url, "file": str(dest), "bytes": size})
        except Exception as e:
            print(f"  [{i}/{len(urls)}] FAILED: {e}")

    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved {len(manifest)} photos to {OUT_DIR}")


if __name__ == "__main__":
    main()
