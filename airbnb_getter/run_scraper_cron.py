#!/usr/bin/env python3
"""
Rotating luxury scraper + auto-messenger.
Picks one new area per run, scrapes mansion listings, messages every uncontacted host.
State is persisted in scraper_state.json alongside this file.
"""

import json
import sys
import time
import traceback
from pathlib import Path

try:
    import lux_bridge as _bridge
    _BRIDGE = True
except Exception:
    _BRIDGE = False

# ── Area rotation list (luxury/mansion markets) ──────────────────────────────
AREAS = [
    "Beverly Hills CA mansions",
    "Bel Air Los Angeles CA mansions",
    "Holmby Hills CA mansions",
    "Pacific Palisades CA luxury homes",
    "Malibu CA oceanfront mansions",
    "Brentwood Los Angeles CA luxury",
    "Hollywood Hills CA luxury homes",
    "Calabasas CA luxury mansions",
    "Hidden Hills CA mansions",
    "Hancock Park CA luxury homes",
    "Los Feliz CA luxury homes",
    "Westwood CA luxury homes",
    "Palos Verdes Estates CA luxury",
    "Manhattan Beach CA luxury homes",
    "Laguna Beach CA luxury mansions",
    "Newport Beach CA luxury mansions",
    "Corona del Mar CA luxury homes",
    "Dana Point CA luxury homes",
    "Rancho Santa Fe CA mansions",
    "La Jolla CA luxury mansions",
    "Del Mar CA luxury homes",
    "Santa Barbara CA luxury mansions",
    "Montecito CA mansions",
    "Carmel by the Sea CA luxury",
    "Pebble Beach CA luxury homes",
    "Atherton CA mansions",
    "Woodside CA luxury estates",
    "Los Altos Hills CA mansions",
    "Hillsborough CA luxury homes",
    "Ross CA luxury homes",
    "Tiburon CA luxury homes",
    "Belvedere CA luxury homes",
    "Sausalito CA luxury homes",
    "Napa Valley CA luxury estates",
    "Sonoma CA luxury wine country homes",
    "Aspen CO luxury mansions",
    "Vail CO luxury homes",
    "Palm Beach FL luxury mansions",
    "Miami Beach FL luxury mansions",
    "Fisher Island FL luxury",
    "Star Island Miami FL luxury",
    "Naples FL luxury mansions",
    "Hamptons NY luxury mansions",
    "Greenwich CT luxury mansions",
    "Westport CT luxury homes",
    "Scottsdale AZ luxury mansions",
    "Paradise Valley AZ luxury homes",
    "Austin TX luxury mansions",
    "Dallas TX luxury mansions",
    "Houston TX luxury mansions",
    "Lake Tahoe CA NV luxury",
    "Big Sur CA luxury",
    "Sedona AZ luxury homes",
    "Charleston SC luxury homes",
    "Savannah GA luxury homes",
    "Nashville TN luxury mansions",
]

MESSAGE_TEMPLATE = """Hi! I was browsing luxury listings and yours caught my eye — stunning property. Quick question: do you ever struggle to stand out from the dozens of similar listings in your area? I work with high-end Airbnb hosts and have something that's been doubling booking rates for properties like yours."""

REPLY_TEMPLATE = """So we create cinematic video flythroughs of luxury properties — the kind you see on high-end real estate sites. Airbnb listings with video get significantly more saves and inquiries than photo-only listings. We build it from photos you already have (or new ones you take). Takes about a week. You can see examples and get yours at luxstudios.shop — hosts in your tier have seen real results. Worth taking a look!"""

MAX_PER_RUN = 50

STATE_FILE = Path(__file__).parent / "scraper_state.json"
LOG_FILE   = Path(__file__).parent / "scraper_cron.log"


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"area_index": 0, "contacted": [], "pending_listings": []}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")


def normalise_id(raw):
    import re
    if not raw:
        return None
    m = re.search(r"/rooms/(\d+)", str(raw))
    return m.group(1) if m else str(raw)


def main():
    import warnings
    warnings.filterwarnings("ignore")

    sys.path.insert(0, str(Path(__file__).parent))
    from airbnb_scraper_full import AirbnbScraper

    state        = load_state()
    area_idx     = state.get("area_index", 0) % len(AREAS)
    contacted    = set(state.get("contacted", []))
    pending      = state.get("pending_listings", [])   # leftover from previous run

    scraper = AirbnbScraper(headless=True)

    # ── If no pending listings, scrape a fresh batch for this area ────────────
    if not pending:
        area = AREAS[area_idx]
        log(f"=== New area [{area_idx+1}/{len(AREAS)}]: {area} ===")
        try:
            results = scraper.search_and_scrape(area, max_listings=60)
        except Exception as e:
            log(f"Search failed: {e}")
            results = []
        log(f"Scraped {len(results)} listings")

        # Build pending list of uncontacted IDs
        for r in results:
            raw = r.get("listing_url") or r.get("listing_data", {}).get("url") or r.get("url", "")
            lid = normalise_id(raw)
            if lid and lid not in contacted:
                pending.append(lid)

        # Deduplicate while preserving order
        seen = set()
        deduped = []
        for lid in pending:
            if lid not in seen:
                seen.add(lid)
                deduped.append(lid)
        pending = deduped
        log(f"{len(pending)} uncontacted listings queued for this area")
    else:
        area = AREAS[area_idx]
        log(f"=== Resuming area [{area_idx+1}/{len(AREAS)}]: {area} | {len(pending)} listings remaining ===")

    # ── Message up to MAX_PER_RUN hosts ───────────────────────────────────────
    batch        = pending[:MAX_PER_RUN]
    leftover     = pending[MAX_PER_RUN:]
    new_contacted = 0

    for lid in batch:
        if lid in contacted:
            continue
        log(f"  Messaging listing {lid}...")
        try:
            result = scraper.message_host(lid, MESSAGE_TEMPLATE)
            status = result.get("status", "unknown")
            log(f"  → {status} | {result.get('url', '')}")
            if status in ("sent", "existing thread", "unknown"):
                contacted.add(lid)
                new_contacted += 1
                if _BRIDGE:
                    try:
                        _bridge.log_outreach(lid, area, MESSAGE_TEMPLATE)
                    except Exception:
                        pass
            elif status == "error_no_dates":
                log(f"  [!] Date picker failed for {lid} — will retry next run")
                # Don't add to contacted so it retries
        except Exception as e:
            log(f"  → Error: {e}")
            traceback.print_exc()
        time.sleep(3)

    # ── Advance area only when all listings for it are exhausted ──────────────
    if leftover:
        log(f"Cap reached. {len(leftover)} listings carried over to next run (same area).")
        state["pending_listings"] = leftover
        # area_index stays the same — resume here next time
    else:
        log(f"Area complete. Advancing to next area.")
        state["pending_listings"] = []
        state["area_index"] = (area_idx + 1) % len(AREAS)

    state["contacted"] = list(contacted)
    save_state(state)

    # ── Run AI conversation engine on inbox ───────────────────────────────────
    thread_states = state.get("thread_states", {})
    # Register any newly contacted listings as outreach_sent
    for lid in batch:
        if lid in contacted and lid not in thread_states:
            thread_states[lid] = "outreach_sent"

    log("Checking inbox — continuing AI conversations...")
    try:
        prev_stages = {k: v for k, v in thread_states.items() if not k.endswith("_msgcount")}
        thread_states = scraper.run_inbox_conversations(thread_states)
        state["thread_states"] = thread_states
        save_state(state)
        active   = sum(1 for k, v in thread_states.items() if not k.endswith("_msgcount") and v != "done")
        closed   = sum(1 for k, v in thread_states.items() if not k.endswith("_msgcount") and v == "done")
        log(f"Conversations — active: {active} | closed/done: {closed}")

        # Fire purchase / delivery events for any threads that just crossed those stages
        if _BRIDGE:
            try:
                for tid, new_stage in thread_states.items():
                    if tid.endswith("_msgcount"):
                        continue
                    old_stage = prev_stages.get(tid, "")
                    if new_stage == "purchased" and old_stage != "purchased":
                        log(f"  [bridge] Purchase — thread {tid}")
                        _bridge.notify_purchase(tid)
                    elif new_stage == "video_sent" and old_stage != "video_sent":
                        log(f"  [bridge] Video delivered — thread {tid}")
                        _bridge.notify_video_sent(tid)
            except Exception as be:
                log(f"  [bridge] Non-fatal: {be}")
    except Exception as e:
        log(f"Inbox conversation engine failed: {e}")
        traceback.print_exc()

    log(f"=== Run complete | Messaged this run: {new_contacted} | Total contacted: {len(contacted)} ===\n")


if __name__ == "__main__":
    main()
