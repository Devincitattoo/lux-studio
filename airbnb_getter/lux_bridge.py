#!/usr/bin/env python3
"""
lux_bridge.py — Integration layer between airbnb_getter and lux-studio.

Writes Airbnb leads, messages, and stage changes into the shared SQLite DB
so the lux-studio dashboard shows everything in one place.

Reads the same .env as lux-studio (loaded by the cron runners).
"""

import os
import sys
import sqlite3
from pathlib import Path

# Resolve DB path from env or default to project data dir
_DB_PATH = os.environ.get("DATABASE_PATH", "")
if not _DB_PATH:
    # Default: project_root/data/lux-studio.db
    project_root = Path(__file__).parent.parent
    _DB_PATH = str(project_root / "data" / "lux-studio.db")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _normalize(value):
    return "" if value is None else str(value)


# Map internal scraper stages to the dashboard-facing lead status.
_STAGE_TO_STATUS = {
    "outreach_sent": "messaged",
    "pitched": "messaged",
    "closing": "pending",
    "purchased": "paid",
    "video_sent": "product_received",
    "done": "thankyou_received",
}


def _status_for_stage(stage):
    return _STAGE_TO_STATUS.get(stage, stage)


# ── Public API ────────────────────────────────────────────────────────────────

def log_outreach(listing_id, area, message):
    """
    Called when an initial outreach message is sent to a host.
    listing_id is the Airbnb room ID (used as thread_id until a real thread opens).
    """
    try:
        with _db() as conn:
            cur = conn.execute(
                "INSERT OR IGNORE INTO reply_assistant_contacts (channel, external_id, display_name) VALUES (?, ?, ?)",
                ("airbnb", str(listing_id), f"Airbnb listing {listing_id}"),
            )
            conn.commit()
            contact = conn.execute(
                "SELECT id FROM reply_assistant_contacts WHERE channel = ? AND external_id = ?",
                ("airbnb", str(listing_id)),
            ).fetchone()
            if not contact:
                return
            contact_id = contact["id"]
            conn.execute(
                "INSERT INTO reply_assistant_messages (contact_id, direction, body, subject, provider_sid) VALUES (?, ?, ?, ?, ?)",
                (contact_id, "outbound", message, f"Outreach – {area}", f"airbnb-{int(os.times().system * 1000)}"),
            )
            conn.execute(
                "INSERT OR IGNORE INTO airbnb_leads (thread_id, listing_id, area, stage, status, contact_id) VALUES (?, ?, ?, ?, ?, ?)",
                (str(listing_id), str(listing_id), _normalize(area), "outreach_sent", "messaged", contact_id),
            )
            conn.execute(
                "UPDATE airbnb_leads SET last_outbound_at = CURRENT_TIMESTAMP, status = ?, updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?",
                ("messaged", str(listing_id)),
            )
            conn.commit()
    except Exception as e:
        print(f"[lux_bridge] log_outreach error: {e}", file=sys.stderr)


def log_host_message(thread_id, message_body):
    """Called when a new message from the host is detected in a thread."""
    if not message_body:
        return
    try:
        with _db() as conn:
            cur = conn.execute(
                "INSERT OR IGNORE INTO reply_assistant_contacts (channel, external_id, display_name) VALUES (?, ?, ?)",
                ("airbnb", str(thread_id), f"Airbnb host {thread_id}"),
            )
            conn.commit()
            contact = conn.execute(
                "SELECT id FROM reply_assistant_contacts WHERE channel = ? AND external_id = ?",
                ("airbnb", str(thread_id)),
            ).fetchone()
            if not contact:
                return
            contact_id = contact["id"]
            conn.execute(
                "INSERT OR IGNORE INTO airbnb_leads (thread_id, listing_id, area, stage, status, contact_id) VALUES (?, ?, ?, ?, ?, ?)",
                (str(thread_id), None, "", "outreach_sent", "replied", contact_id),
            )
            conn.execute(
                "INSERT INTO reply_assistant_messages (contact_id, direction, body, subject, provider_sid) VALUES (?, ?, ?, ?, ?)",
                (contact_id, "inbound", message_body, "Airbnb Reply", f"airbnb-{int(os.times().system * 1000)}"),
            )
            conn.execute(
                "UPDATE airbnb_leads SET last_inbound_at = CURRENT_TIMESTAMP, status = ?, updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?",
                ("replied", str(thread_id)),
            )
            conn.commit()
    except Exception as e:
        print(f"[lux_bridge] log_host_message error: {e}", file=sys.stderr)


def log_ai_reply(thread_id, reply_body, stage):
    """Called after the AI sends a reply. Logs it as outbound."""
    if not reply_body:
        return
    try:
        with _db() as conn:
            contact = conn.execute(
                "SELECT id FROM reply_assistant_contacts WHERE channel = ? AND external_id = ?",
                ("airbnb", str(thread_id)),
            ).fetchone()
            if not contact:
                return
            contact_id = contact["id"]
            msg_cur = conn.execute(
                "INSERT INTO reply_assistant_messages (contact_id, direction, body, subject, provider_sid) VALUES (?, ?, ?, ?, ?)",
                (contact_id, "outbound", reply_body, "Airbnb Reply", f"airbnb-{int(os.times().system * 1000)}"),
            )
            conn.execute(
                "INSERT INTO reply_assistant_pending_replies (contact_id, inbound_message_id, draft_body, reasoning, status) VALUES (?, ?, ?, ?, ?)",
                (contact_id, None, reply_body, f"Auto-sent by Airbnb AI — stage: {stage}", "approved"),
            )
            status = _status_for_stage(stage) if stage else "messaged"
            conn.execute(
                "UPDATE airbnb_leads SET last_outbound_at = CURRENT_TIMESTAMP, status = ?, updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?",
                (status, str(thread_id)),
            )
            conn.commit()
    except Exception as e:
        print(f"[lux_bridge] log_ai_reply error: {e}", file=sys.stderr)


def update_stage(thread_id, stage):
    """Update the lead's stage in airbnb_leads."""
    try:
        with _db() as conn:
            status = _status_for_stage(stage)
            conn.execute(
                "UPDATE airbnb_leads SET stage = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?",
                (stage, status, str(thread_id)),
            )
            conn.commit()
    except Exception as e:
        print(f"[lux_bridge] update_stage error: {e}", file=sys.stderr)


def notify_purchase(thread_id, host_display_name=None):
    """Stage → purchased. Logs a purchase event and updates lead stage."""
    try:
        with _db() as conn:
            cur = conn.execute(
                "INSERT OR IGNORE INTO reply_assistant_contacts (channel, external_id, display_name) VALUES (?, ?, ?)",
                ("airbnb", str(thread_id), _normalize(host_display_name) or f"Airbnb host {thread_id}"),
            )
            conn.commit()
            contact = conn.execute(
                "SELECT id FROM reply_assistant_contacts WHERE channel = ? AND external_id = ?",
                ("airbnb", str(thread_id)),
            ).fetchone()
            if not contact:
                return
            contact_id = contact["id"]
            conn.execute(
                "INSERT OR IGNORE INTO airbnb_leads (thread_id, listing_id, area, stage, status, contact_id) VALUES (?, ?, ?, ?, ?, ?)",
                (str(thread_id), None, "", "purchased", "paid", contact_id),
            )
            conn.execute(
                "UPDATE airbnb_leads SET stage = 'purchased', status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?",
                (str(thread_id),),
            )
            body = (
                f"[PURCHASE] Host purchased a LuxStudios video flythrough via Airbnb thread {thread_id}. "
                "Awaiting photos to begin production."
            )
            conn.execute(
                "INSERT INTO reply_assistant_messages (contact_id, direction, body, subject, provider_sid) VALUES (?, ?, ?, ?, ?)",
                (contact_id, "inbound", body, "New Purchase — Awaiting Photos", f"airbnb-{int(os.times().system * 1000)}"),
            )
            conn.commit()
            print(f"[lux_bridge] Purchase recorded — thread {thread_id}")
    except Exception as e:
        print(f"[lux_bridge] notify_purchase error: {e}", file=sys.stderr)


def notify_video_sent(thread_id):
    """Stage → video_sent. Logs delivery and marks lead done."""
    try:
        with _db() as conn:
            contact = conn.execute(
                "SELECT id FROM reply_assistant_contacts WHERE channel = ? AND external_id = ?",
                ("airbnb", str(thread_id)),
            ).fetchone()
            if not contact:
                return
            contact_id = contact["id"]
            conn.execute(
                "UPDATE airbnb_leads SET stage = 'video_sent', status = 'product_received', updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?",
                (str(thread_id),),
            )
            body = f"[DELIVERED] Video flythrough delivered to host via Airbnb thread {thread_id}."
            conn.execute(
                "INSERT INTO reply_assistant_messages (contact_id, direction, body, subject, provider_sid) VALUES (?, ?, ?, ?, ?)",
                (contact_id, "outbound", body, "Video Delivered", f"airbnb-{int(os.times().system * 1000)}"),
            )
            conn.commit()
            print(f"[lux_bridge] Delivery logged — thread {thread_id}")
    except Exception as e:
        print(f"[lux_bridge] notify_video_sent error: {e}", file=sys.stderr)


def create_intervention(thread_id, reason):
    """Open a human-intervention ticket for a lead."""
    try:
        with _db() as conn:
            lead = conn.execute(
                "SELECT id, contact_id FROM airbnb_leads WHERE thread_id = ?", (str(thread_id),)
            ).fetchone()
            if not lead:
                return
            conn.execute(
                "INSERT INTO interventions (contact_id, lead_id, reason, status) VALUES (?, ?, ?, 'open')",
                (lead["contact_id"], lead["id"], _normalize(reason)),
            )
            conn.commit()
            print(f"[lux_bridge] Intervention opened — thread {thread_id}")
    except Exception as e:
        print(f"[lux_bridge] create_intervention error: {e}", file=sys.stderr)


def mark_unresponsive(thread_id):
    """Mark a lead as unresponsive."""
    try:
        with _db() as conn:
            conn.execute(
                "UPDATE airbnb_leads SET status = 'unresponsive', unresponsive = 1, updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?",
                (str(thread_id),),
            )
            conn.commit()
    except Exception as e:
        print(f"[lux_bridge] mark_unresponsive error: {e}", file=sys.stderr)


def record_video_job(listing_id, photo_index, status='pending', cost=0.0, queue_id=None, file_path=None):
    """Track a video-generation job and its cost in the dashboard."""
    try:
        with _db() as conn:
            lead = conn.execute("SELECT id FROM airbnb_leads WHERE listing_id = ?", (str(listing_id),)).fetchone()
            lead_id = lead["id"] if lead else None
            cur = conn.execute(
                """INSERT INTO video_jobs (lead_id, listing_id, photo_indices, status, cost, venice_queue_id, file_path)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (lead_id, str(listing_id), str(photo_index), status, float(cost), _normalize(queue_id), _normalize(file_path)),
            )
            conn.commit()
            print(f"[lux_bridge] Video job recorded — id {cur.lastrowid}, listing {listing_id}, photo {photo_index}, status {status}")
            return cur.lastrowid
    except Exception as e:
        print(f"[lux_bridge] record_video_job error: {e}", file=sys.stderr)
        return None


def update_video_job_status(job_id, status, file_path=None):
    """Update video job status (e.g. completed, failed, sent)."""
    try:
        with _db() as conn:
            now = int(os.times().system * 1000)
            extra = ""
            params = [status]
            if file_path:
                extra += ", file_path = ?"
                params.append(file_path)
            if status == "sent":
                extra += ", sent_at = CURRENT_TIMESTAMP"
            if status == "received":
                extra += ", received_at = CURRENT_TIMESTAMP"
            params.append(job_id)
            conn.execute(
                f"UPDATE video_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP{extra} WHERE id = ?",
                tuple(params),
            )
            conn.commit()
            print(f"[lux_bridge] Video job {job_id} → {status}")
    except Exception as e:
        print(f"[lux_bridge] update_video_job_status error: {e}", file=sys.stderr)
