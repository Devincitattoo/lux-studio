#!/usr/bin/env python3
"""
Airbnb Scraper — Full listing data + host contact extraction.
Requires: pip install requests beautifulsoup4 selenium webdriver-manager lxml
"""

import os
import re
import base64
import json
import time
import random
import requests
from pathlib import Path
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

try:
    import lux_bridge as _bridge
    _BRIDGE = True
except Exception:
    _BRIDGE = False

COOKIES_FILE = Path(__file__).parent / "airbnb_session.json"
AIRBNB_EMAIL = os.environ.get("AIRBNB_EMAIL", "devincitattoo@icloud.com")
AIRBNB_PASSWORD = os.environ.get("AIRBNB_PASSWORD", "Ajax9767")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ...",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ...",
]

def random_ua():
    return random.choice(USER_AGENTS)

class AirbnbScraper:
    def __init__(self, headless=True):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": random_ua()})
        self.driver = None
        self.headless = headless

    def _make_driver(self, headless=None, perf_log=False):
        opts = Options()
        if (headless if headless is not None else self.headless):
            opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--window-size=1400,900")
        opts.add_argument(f"user-agent={random_ua()}")
        if perf_log:
            opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
        return webdriver.Chrome(options=opts)

    def _js_click(self, driver, el):
        driver.execute_script("arguments[0].click();", el)

    def _dismiss_cookies(self, driver):
        for b in driver.find_elements(By.TAG_NAME, "button"):
            if any(w in b.text.lower() for w in ["accept all", "only necessary"]):
                self._js_click(driver, b)
                time.sleep(1)
                return

    def _save_cookies(self, driver):
        COOKIES_FILE.write_text(json.dumps(driver.get_cookies(), indent=2))
        print(f"Session saved to {COOKIES_FILE}")

    def _load_cookies(self, driver):
        if not COOKIES_FILE.exists():
            return False
        driver.get("https://www.airbnb.ca")
        time.sleep(2)
        for cookie in json.loads(COOKIES_FILE.read_text()):
            try:
                driver.add_cookie(cookie)
            except Exception:
                pass
        driver.refresh()
        time.sleep(3)
        # Check if still logged in
        if "login" not in driver.current_url and driver.find_elements(By.XPATH, "//*[@data-testid='header-profile-menu']"):
            return True
        # Softer check — look for user avatar or profile icon
        if driver.find_elements(By.XPATH, "//*[contains(@aria-label,'Profile') or contains(@aria-label,'Account')]"):
            return True
        return False

    def login(self, email=AIRBNB_EMAIL, password=AIRBNB_PASSWORD):
        """Log in to Airbnb, reusing saved session if available."""
        # Cookie reuse is always headless-safe; only force visible browser when a fresh login is needed
        headless_for_reuse = self.headless
        driver = self._make_driver(headless=headless_for_reuse, perf_log=True)
        wait = WebDriverWait(driver, 15)

        # Try loading saved cookies first
        if self._load_cookies(driver):
            print("Reusing saved session — skipping login.")
            return driver

        # Need a real login — reopen visible so the user can see/interact
        driver.quit()
        driver = self._make_driver(headless=False, perf_log=True)
        wait = WebDriverWait(driver, 15)
        print("No valid session found, logging in...")
        driver.get("https://www.airbnb.com/login")
        time.sleep(4)
        self._dismiss_cookies(driver)

        # Enter email
        field = wait.until(EC.presence_of_element_located((By.ID, "phone-or-email")))
        field.send_keys(email)
        self._js_click(driver, driver.find_element(By.XPATH, "//button[normalize-space()='Continue']"))
        time.sleep(4)

        # Try another way -> password
        for b in driver.find_elements(By.TAG_NAME, "button"):
            if "another way" in b.text.lower():
                self._js_click(driver, b)
                break
        time.sleep(2)
        self._dismiss_cookies(driver)
        for b in driver.find_elements(By.TAG_NAME, "button"):
            if "password" in b.text.lower():
                self._js_click(driver, b)
                break
        time.sleep(2)

        pw = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@type='password']")))
        pw.send_keys(password)
        for b in driver.find_elements(By.TAG_NAME, "button"):
            if "continue" in b.text.lower():
                self._js_click(driver, b)
                break
        time.sleep(5)

        if "login" in driver.current_url:
            raise RuntimeError(f"Login failed — still on: {driver.current_url}")

        print(f"Logged in: {driver.current_url}")
        self._save_cookies(driver)
        return driver

    def _selenium_get(self, url):
        driver = self._make_driver()
        driver.get(url)
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        time.sleep(5)
        html = driver.page_source
        driver.quit()
        return html

    # Domains to exclude from email results (Airbnb internals, CDNs, trackers)
    _NOISE_DOMAINS = {
        "airbnb.com", "sentry.io", "muscache.com", "googleapis.com",
        "facebook.com", "twitter.com", "instagram.com", "apple.com",
        "w3.org", "schema.org", "example.com",
    }

    def _extract_email_phone(self, html):
        emails = set()
        phones = set()
        soup = BeautifulSoup(html, "lxml")

        # Pull visible text from description and host bio sections only
        text_sources = []
        for tag in soup.find_all(["p", "span", "div", "section"]):
            t = tag.get_text(" ", strip=True)
            if len(t) > 20:
                text_sources.append(t)
        text_blob = " ".join(text_sources)

        # Standard email pattern — run on text content, not raw HTML
        email_re = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
        for match in email_re.findall(text_blob):
            domain = match.split("@")[-1].lower()
            if not any(domain == d or domain.endswith("." + d) for d in self._NOISE_DOMAINS):
                emails.add(match)

        # Obfuscated email patterns: "name [at] gmail dot com"
        obf_re = re.compile(
            r"[a-zA-Z0-9._%+-]+\s*[\[\(]?\s*at\s*[\]\)]?\s*[a-zA-Z0-9.-]+\s*[\[\(]?\s*dot\s*[\]\)]?\s*[a-zA-Z]{2,}",
            re.IGNORECASE,
        )
        for match in obf_re.findall(text_blob):
            normalized = re.sub(r"\s*[\[\(]?\s*at\s*[\]\)]?\s*", "@", match, flags=re.IGNORECASE)
            normalized = re.sub(r"\s*[\[\(]?\s*dot\s*[\]\)]?\s*", ".", normalized, flags=re.IGNORECASE)
            emails.add(normalized.strip())

        # Phone numbers — US/international formats
        phone_re = re.compile(r"(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}")
        for match in phone_re.findall(text_blob):
            phones.add(match.strip())

        # Also scan JSON-LD structured data
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if isinstance(item, dict):
                        if "email" in item:
                            emails.add(item["email"])
                        if "telephone" in item:
                            phones.add(item["telephone"])
            except (json.JSONDecodeError, AttributeError):
                pass

        return list(emails), list(phones)

    def scrape_listing_data(self, listing_url, html=None):
        """Extract listing details from a listing page."""
        if html is None:
            html = self._selenium_get(listing_url)
        soup = BeautifulSoup(html, "lxml")
        data = {"url": listing_url}

        # Title
        title_tag = soup.find("h1")
        if title_tag:
            data["title"] = title_tag.get_text(strip=True)

        # Price per night (common patterns)
        price_re = re.compile(r"\$\d{1,4}(?:,\d{3})*")
        prices = price_re.findall(html)
        if prices:
            data["price_mentions"] = prices[:5]

        # Location
        loc_meta = soup.find("meta", attrs={"name": "description"})
        if loc_meta:
            data["description"] = loc_meta.get("content", "")

        # JSON-LD for structured data
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                obj = json.loads(script.string)
                if isinstance(obj, dict) and "@type" in obj:
                    if "name" in obj:
                        data["name"] = obj["name"]
                    if "description" in obj:
                        data["ld_description"] = obj["description"]
                    if "geo" in obj:
                        data["geo"] = obj["geo"]
                    if "address" in obj:
                        data["address"] = obj["address"]
                    if "priceRange" in obj:
                        data["price_range"] = obj["priceRange"]
                    if "starRating" in obj:
                        data["star_rating"] = obj["starRating"]
                    if "reviewCount" in obj:
                        data["review_count"] = obj["reviewCount"]
            except (json.JSONDecodeError, AttributeError):
                pass

        # Amenities (often in a list with data section)
        amenity_section = soup.find("div", attrs={"data-section-id": "AMENITIES_DEFAULT"})
        if amenity_section:
            amenity_items = amenity_section.find_all("span")
            data["amenities"] = [a.get_text(strip=True) for a in amenity_items if a.get_text(strip=True)]

        # Rating score
        rating_re = re.compile(r"(\d+\.\d+) out of \d+ reviews")
        ratings = rating_re.findall(html)
        if ratings:
            data["rating"] = ratings[0]

        # Bedrooms / beds / baths (common in listing page text)
        bb_re = re.compile(r"(\d+)\s*(?:bedroom|bed|bathroom|bath)", re.IGNORECASE)
        bb_counts = bb_re.findall(html)
        if bb_counts:
            data["room_counts"] = [int(x) for x in bb_counts]

        return data

    def _extract_host_from_html(self, html):
        """Extract host info from PassportCardData embedded in listing HTML."""
        host = {}
        m = re.search(r'"PassportCardData","name":"([^"]+)".*?"userId":"([^"]+)".*?"titleText":"([^"]*)".*?"profilePictureUrl":"([^"]*)".*?"isSuperhost":(true|false)', html, re.DOTALL)
        if m:
            host["name"] = m.group(1)
            host["is_superhost"] = m.group(5) == "true"
            host["profile_picture"] = m.group(4)

        host_id_m = re.search(r'"hostId":"(\d+)"', html)
        if host_id_m:
            host["host_id"] = host_id_m.group(1)
            host["host_profile"] = f"https://www.airbnb.com/users/show/{host_id_m.group(1)}"

        for stat in re.finditer(r'"label":"([^"]+)","value":"([^"]+)".*?"type":"([^"]+)"', html):
            label, value, kind = stat.group(1), stat.group(2), stat.group(3)
            if kind == "REVIEW_COUNT":
                host["review_count"] = value
            elif kind == "RATING":
                host["rating"] = value
            elif kind == "YEARS_HOSTING":
                host["years_hosting"] = value

        return host

    def profile_from_listing(self, listing_url):
        """Given a listing page, extract host profile data and listing details."""
        html = self._selenium_get(listing_url)
        host = self._extract_host_from_html(html)

        # Try to find contact info in listing HTML first
        emails, phones = self._extract_email_phone(html)

        # Also fetch host profile page if we have the URL
        if host.get("host_profile"):
            try:
                resp = self.session.get(host["host_profile"], timeout=15)
                profile_html = resp.text if resp.status_code == 200 else self._selenium_get(host["host_profile"])
                p_emails, p_phones = self._extract_email_phone(profile_html)
                emails = list(set(emails) | set(p_emails))
                phones = list(set(phones) | set(p_phones))
            except Exception:
                pass

        host["emails"] = emails
        host["phones"] = phones

        listing_data = self.scrape_listing_data(listing_url, html=html)
        return {
            "host": host if host else {"error": "Host data not found"},
            "listing_data": listing_data,
        }

    # Persisted query hash for SendContactHostMessageMutation (captured from live traffic)
    _SEND_MSG_HASH = "8d117119317854fbf1fc2dbb5cc8d3aade5875eaa57af0c97dca2f8791632202"
    _API_KEY       = "d306zoyjsyarp7ifhu67rjxn52tv0t20"

    def _get_api_session(self):
        """Build a requests session loaded with saved Airbnb cookies."""
        s = requests.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "Content-Type": "application/json",
            "X-Airbnb-API-Key": self._API_KEY,
            "X-Airbnb-GraphQL-Platform": "web",
            "X-Airbnb-GraphQL-Platform-Client": "minimalist-niobe",
            "X-CSRF-Token": "",
        })
        if COOKIES_FILE.exists():
            for c in json.loads(COOKIES_FILE.read_text()):
                s.cookies.set(c["name"], c["value"], domain=c.get("domain", ".airbnb.com"))
        return s

    def _pick_available_dates(self, driver, months_ahead=1):
        """Open the date picker, navigate to a future month, and return (checkin_label, checkout_label)."""
        dates_btn = driver.find_element(By.XPATH, "//button[contains(@aria-label,'Check-in') or contains(@aria-label,'Change dates')]")
        driver.execute_script("arguments[0].click();", dates_btn)
        time.sleep(2)
        for _ in range(months_ahead + 1):
            driver.execute_script("document.querySelector('button[aria-label*=\"Move forward\"]').click()")
            time.sleep(0.8)
        # Pick first available check-in
        driver.execute_script("""
            const cells = Array.from(document.querySelectorAll('td[role="button"]'));
            const avail = cells.filter(td => td.getAttribute('aria-disabled') === 'false');
            if (avail.length) avail[0].click();
        """)
        time.sleep(1.5)
        # Pick 4 days later as checkout
        driver.execute_script("""
            const cells = Array.from(document.querySelectorAll('td[role="button"]'));
            const avail = cells.filter(td => td.getAttribute('aria-disabled') === 'false');
            if (avail.length >= 4) avail[3].click();
        """)
        time.sleep(1)
        driver.execute_script("""
            const btns = Array.from(document.querySelectorAll('button'));
            const save = btns.find(b => b.textContent.trim().toLowerCase() === 'save');
            if (save) save.click();
        """)
        time.sleep(2)

    def message_host(self, listing_id, message, checkin=None, checkout=None, adults=2):
        """Send a message to a host via the /contact_host/<id>/send_message form."""
        if "/" in listing_id:
            listing_id = re.search(r"/rooms/(\d+)", listing_id).group(1)

        driver = self.login()
        wait = WebDriverWait(driver, 20)
        try:
            driver.get(f"https://www.airbnb.ca/contact_host/{listing_id}/send_message")
            time.sleep(6)
            self._dismiss_cookies(driver)

            # If we already landed on a thread (existing conversation), return it
            if "/guest/messages/" in driver.current_url:
                return {"status": "sent", "listing_id": listing_id, "url": driver.current_url, "response": "Existing thread"}

            if "login" in driver.current_url or "signup" in driver.current_url:
                return {"status": "error", "listing_id": listing_id, "response": "Not authenticated"}

            # Select dates via calendar widget
            try:
                self._pick_available_dates(driver, months_ahead=1)
            except Exception as e:
                print(f"  [!] Date picker issue: {e}")

            # Fill message
            msg_area = wait.until(EC.presence_of_element_located((By.ID, "contactHostMessage")))
            msg_area.click()
            time.sleep(0.5)
            msg_area.send_keys(message)
            time.sleep(1)

            # Click Send
            driver.execute_script("""
                const btns = Array.from(document.querySelectorAll('button'));
                const send = btns.find(b => /^send/i.test(b.textContent.trim()));
                if (send) send.click();
            """)
            time.sleep(6)

            final_url = driver.current_url
            # Confirmed thread redirect
            if "/guest/messages/" in final_url or "thread" in final_url:
                status = "sent"
            # Form submitted with dates — message almost certainly went through
            elif "send_message" in final_url and ("check_in=" in final_url or "check_out=" in final_url):
                status = "sent"
            # Still on form without dates — calendar picker failed
            elif "#availability-calendar" in final_url:
                status = "error_no_dates"
            else:
                status = "sent"  # default optimistic — form was reached and submitted

            return {
                "status": status,
                "listing_id": listing_id,
                "url": final_url,
                "response": "Message sent",
            }
        finally:
            driver.quit()

    def search_and_scrape(self, query, max_listings=10):
        """Search Airbnb, enumerate listings, scrape listing data + host data."""
        search_url = f"https://www.airbnb.com/s/{requests.utils.quote(query)}/homes"
        html = self._selenium_get(search_url)
        soup = BeautifulSoup(html, "lxml")
        listing_links = []
        for a in soup.find_all("a", href=re.compile(r"/rooms/")):
            href = a["href"]
            full = "https://www.airbnb.com" + href if href.startswith("/") else href
            listing_links.append(full)
        listing_links = list(dict.fromkeys(listing_links))[:max_listings]
        results = []
        for i, link in enumerate(listing_links, 1):
            print(f"[*] Processing listing {i}/{len(listing_links)}: {link}")
            result = self.profile_from_listing(link)
            result["listing_url"] = link
            results.append(result)
            time.sleep(random.uniform(3, 6))
        return results

    # ── Conversation stages ──────────────────────────────────────────────────
    # outreach_sent → pitched → closing → purchased → video_sent → done
    _SALES_SYSTEM_PROMPT = """You are a sales rep for LuxStudios, a company that creates cinematic video flythroughs of luxury Airbnb properties. Your goal is to close the sale — get the host to purchase a video flythrough at luxstudios.shop.

Product: Custom video flythrough built from the host's property photos. Hosts submit their photos after purchase. Results vary based on photo quality/quantity. Dramatically increases bookings.

Your tone: friendly, confident, professional. Not pushy. Focus on value (more bookings, higher perceived value, stand out from competition).

Conversation stages:
- PITCHED: You've introduced the product. Host is engaging. Keep building value, handle objections, guide toward purchase.
- CLOSING: Host is interested/asking about price/process. Push them to visit luxstudios.shop to complete purchase.
- PURCHASED: Host has bought. Thank them warmly, tell them to submit their property photos so you can start.
- VIDEO_SENT: Video has been delivered. Send a warm farewell, congratulate them on their new asset, wish them great bookings.

Rules:
- Never break character. You are a real sales rep.
- Keep messages concise — 2-4 sentences max.
- Always include luxstudios.shop when relevant.
- If they ask price/details, direct them to luxstudios.shop.
- If they seem done / not interested, be gracious and leave the door open.
- Respond ONLY with the message text — no labels, no stage names, no meta commentary."""

    def _read_thread_messages(self, driver):
        """Extract all messages from the current thread page."""
        return driver.execute_script("""
            const results = [];
            // Try multiple selectors for message containers
            const selectors = [
                '[data-testid*="message"]',
                '[class*="MessageBubble"]',
                '[class*="message-bubble"]',
                '[class*="ConversationMessage"]',
            ];
            let containers = [];
            for (const sel of selectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) { containers = Array.from(found); break; }
            }
            // Fallback: grab all paragraphs inside the main content
            if (containers.length === 0) {
                containers = Array.from(document.querySelectorAll('main p, [role="main"] p'));
            }
            containers.forEach(el => {
                const text = el.innerText?.trim();
                if (text && text.length > 2) results.push(text);
            });
            return results;
        """)

    def _send_thread_reply(self, driver, message):
        """Type and send a reply in the currently open thread."""
        wait = WebDriverWait(driver, 10)
        try:
            textarea = wait.until(EC.presence_of_element_located((
                By.XPATH, "//textarea | //div[@role='textbox' and @contenteditable='true']"
            )))
            textarea.click()
            time.sleep(0.5)
            textarea.send_keys(message)
            time.sleep(1)
            driver.execute_script("""
                const btns = Array.from(document.querySelectorAll('button'));
                const send = btns.find(b => /^send/i.test(b.textContent.trim()) ||
                                           /send/i.test(b.getAttribute('aria-label') || ''));
                if (send) send.click();
            """)
            time.sleep(3)
            return True
        except Exception as e:
            print(f"    send_reply error: {e}")
            return False

    def _ai_reply(self, thread_history, stage):
        """Generate next reply using Claude based on conversation history and stage."""
        try:
            import anthropic
            client = anthropic.Anthropic(api_key="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")
            stage_context = {
                "outreach_sent": "PITCHED",
                "pitched":       "PITCHED",
                "closing":       "CLOSING",
                "purchased":     "PURCHASED",
                "video_sent":    "VIDEO_SENT",
            }.get(stage, "PITCHED")

            history_text = "\n".join(
                f"{'HOST' if i % 2 == 1 else 'YOU'}: {m}"
                for i, m in enumerate(thread_history)
            )

            msg = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                system=self._SALES_SYSTEM_PROMPT,
                messages=[{
                    "role": "user",
                    "content": f"Current stage: {stage_context}\n\nConversation so far:\n{history_text}\n\nWrite your next reply:"
                }]
            )
            return msg.content[0].text.strip()
        except Exception as e:
            print(f"    AI reply error: {e}")
            return None

    def _detect_stage(self, messages, current_stage):
        """Advance stage based on keywords in latest host message."""
        if not messages:
            return current_stage
        latest = messages[-1].lower()

        purchase_keywords = ["bought", "purchased", "ordered", "paid", "payment", "checkout",
                             "just bought", "just ordered", "completed", "went ahead"]
        video_keywords    = ["received", "got the video", "looks great", "love it", "amazing video",
                             "got it", "video arrived"]
        interest_keywords = ["interested", "how much", "price", "cost", "how does it work",
                             "tell me more", "sounds good", "i'd like", "would love"]

        if current_stage in ("outreach_sent", "pitched"):
            if any(k in latest for k in purchase_keywords):
                return "purchased"
            if any(k in latest for k in interest_keywords):
                return "closing"
            return "pitched"
        if current_stage == "closing":
            if any(k in latest for k in purchase_keywords):
                return "purchased"
            return "closing"
        if current_stage == "purchased":
            if any(k in latest for k in video_keywords):
                return "video_sent"
            return "purchased"
        return current_stage

    def run_inbox_conversations(self, thread_states):
        """
        Check inbox, continue conversations with AI replies based on each thread's stage.
        thread_states: dict of {thread_id: stage_string}
        Returns updated thread_states.
        """
        driver = self.login()
        wait = WebDriverWait(driver, 15)
        updated = dict(thread_states)

        try:
            driver.get("https://www.airbnb.ca/guest/inbox")
            time.sleep(5)
            self._dismiss_cookies(driver)

            thread_links = driver.execute_script("""
                return Array.from(document.querySelectorAll('a[href*="/guest/messages/"]'))
                    .map(a => a.href)
                    .filter((v, i, arr) => arr.indexOf(v) === i);
            """)
            print(f"  [inbox] {len(thread_links)} threads found")

            for thread_url in thread_links:
                m = re.search(r"/guest/messages/(\d+)", thread_url)
                if not m:
                    continue
                tid = m.group(1)

                stage = updated.get(tid, "outreach_sent")
                if stage == "done":
                    continue

                driver.get(thread_url)
                time.sleep(4)

                if "/guest/messages/" not in driver.current_url:
                    continue

                messages = self._read_thread_messages(driver)
                if not messages:
                    continue

                # Only reply if the last message is from the host (odd index = host if we sent first)
                # Heuristic: if message count changed since last check, there's something new
                prev_count = updated.get(f"{tid}_msgcount", 0)
                curr_count = len(messages)
                if curr_count <= prev_count:
                    continue  # no new messages

                updated[f"{tid}_msgcount"] = curr_count

                # Log new host messages to Supabase
                latest_inbound_message_id = None
                if _BRIDGE:
                    try:
                        for msg in messages[prev_count:]:
                            logged = _bridge.log_host_message(tid, msg)
                            if logged and logged.get("id"):
                                latest_inbound_message_id = logged["id"]
                    except Exception:
                        pass

                # Advance stage based on latest host message
                new_stage = self._detect_stage(messages, stage)
                updated[tid] = new_stage

                if _BRIDGE and new_stage != stage:
                    try:
                        _bridge.update_stage(tid, new_stage)
                    except Exception:
                        pass

                if new_stage == "done":
                    continue

                # Generate AI reply
                reply = self._ai_reply(messages, new_stage)
                if not reply:
                    continue

                print(f"  [inbox] Thread {tid} | stage: {new_stage} | replying...")
                sent = self._send_thread_reply(driver, reply)

                if sent:
                    if _BRIDGE:
                        try:
                            _bridge.log_ai_reply(tid, reply, new_stage, latest_inbound_message_id)
                        except Exception:
                            pass
                    if new_stage == "video_sent":
                        updated[tid] = "done"
                        print(f"  [inbox] Thread {tid} marked done (video delivered).")

                time.sleep(2)

        finally:
            driver.quit()

        return updated


if __name__ == "__main__":
    import sys
    query = sys.argv[1] if len(sys.argv) > 1 else "Manhattan"
    scraper = AirbnbScraper(headless=True)
    data = scraper.search_and_scrape(query, max_listings=5)
    print(json.dumps(data, indent=2, default=str))
