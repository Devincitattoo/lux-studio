#!/usr/bin/env python3
"""
run_inbox_cron.py — Inbox-only runner.
Checks Airbnb inbox every run and has Claude reply to any new host messages.
Run this every 2 minutes via cron — separate from the 30-min scraper job.
"""

import sys
import time
import json
import traceback
from pathlib import Path

# Load .env
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    import os
    for _line in _env_file.read_text().splitlines():
        if _line.strip() and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

try:
    import lux_bridge as _bridge
    _BRIDGE = True
except Exception:
    _BRIDGE = False

STATE_FILE = Path(__file__).parent / "scraper_state.json"
LOG_FILE   = Path(__file__).parent / "inbox_cron.log"


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def main():
    import warnings
    warnings.filterwarnings("ignore")

    sys.path.insert(0, str(Path(__file__).parent))
    from airbnb_scraper_full import AirbnbScraper

    state = load_state()
    thread_states = state.get("thread_states", {})

    if not thread_states:
        log("No active threads — nothing to do.")
        return

    active = sum(1 for k, v in thread_states.items() if not k.endswith("_msgcount") and v not in ("done",))
    log(f"Checking inbox — {active} active threads...")

    scraper = AirbnbScraper(headless=True)

    try:
        prev_stages = {k: v for k, v in thread_states.items() if not k.endswith("_msgcount")}
        thread_states = scraper.run_inbox_conversations(thread_states)
        state["thread_states"] = thread_states
        save_state(state)

        replied = sum(
            1 for k in thread_states
            if not k.endswith("_msgcount") and thread_states.get(f"{k}_msgcount", 0) != prev_stages.get(f"{k}_msgcount", 0)
        )
        log(f"Inbox run complete — replied to new messages.")

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
        log(f"Inbox run failed: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()
