#!/usr/bin/env python3
"""
save_session.py — Open a visible Chrome window, log into Airbnb, and save the session cookies.

Run this once from your Terminal:
  cd "/Users/dvncii/GitHub LUX /lux-studio/airbnb_getter"
  source venv/bin/activate
  python3 save_session.py

A Chrome window will open. Log into Airbnb manually (solve any captcha if shown).
Once you're logged in, press Enter in the Terminal. The session will be saved to
airbnb_session.json for future headless scraper runs.
"""

import os
import sys
import time
from pathlib import Path

# Load .env from this directory
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

sys.path.insert(0, str(Path(__file__).parent))
from airbnb_scraper_full import AirbnbScraper


def main():
    print("Opening Chrome. Please log into Airbnb in the browser window.")
    print("After you're logged in, come back here and press Enter to save the session.")

    # Force visible browser
    scraper = AirbnbScraper(headless=False)
    driver = scraper._make_driver(headless=False, perf_log=False)

    try:
        driver.get("https://www.airbnb.com/login")
        input("\nPress Enter once you are logged into Airbnb...")

        scraper._save_cookies(driver)
        print(f"Session saved to {scraper.COOKIES_FILE}")
        print("Future headless runs will reuse this session.")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
