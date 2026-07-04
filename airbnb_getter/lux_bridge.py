#!/usr/bin/env python3
"""
lux_bridge.py — Full integration layer between airbnb_getter and lux-studio.

Writes every Airbnb lead, message, and stage change into the shared Supabase DB
so the lux-studio dashboard shows everything in one place.

Env vars required (same ones lux-studio uses):
  SUPABASE_URL          https://your-project.supabase.co
  SUPABASE_SECRET_KEY   service-role key (bypasses RLS)
"""

import os
import time
import requests

_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")


def _ok():
    return bool(_URL and _KEY)


def _h():
    return {
        "apikey": _KEY,
        "Authorization": f"Bearer {_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _get(table, params):
    try:
        r = requests.get(f"{_URL}/rest/v1/{table}", headers=_h(), params=params, timeout=10)
        return r.json() if r.ok else []
    except Exception:
        return []


def _post(table, payload):
    try:
        r = requests.post(f"{_URL}/rest/v1/{table}", headers=_h(), json=payload, timeout=10)
        data = r.json() if r.ok else {}
        return data[0] if isinstance(data, list) and data else data
    except Exception:
        return {}


def _patch(table, params, payload):
    try:
        h = {**_h(), "Prefer": "return=minimal"}
        requests.patch(f"{_URL}/rest/v1/{table}", headers=h, params=params, json=payload, timeout=10)
    except Exception:
        pass


# ── Contact helpers ───────────────────────────────────────────────────────────

def ensure_contact(thread_id, display_name=None):
    """Return contact_id for this Airbnb thread, creating it if needed."""
    rows = _get("reply_assistant_contacts", {
        "channel": "eq.airbnb",
        "external_id": f"eq.{thread_id}",
        "select": "id",
    })
    if rows:
        return rows[0]["id"]
    row = _post("reply_assistant_contacts", {
        "channel": "airbnb",
        "external_id": thread_id,
        "display_name": display_name or f"Airbnb host {thread_id}",
    })
    return row.get("id")


def _log_msg(contact_id, body, direction="inbound", subject=None, provider_sid=None):
    sid = provider_sid or f"airbnb-{int(time.time() * 1000)}"
    payload = {
        "contact_id": contact_id,
        "direction": direction,
        "body": body,
        "provider_sid": sid,
    }
    if subject:
        payload["subject"] = subject
    return _post("reply_assistant_messages", payload)


def _ensure_lead(thread_id, contact_id, listing_id=None, area=None, stage="outreach_sent"):
    """Upsert a row in airbnb_leads."""
    rows = _get("airbnb_leads", {"thread_id": f"eq.{thread_id}", "select": "id,stage"})
    if rows:
        return rows[0]
    return _post("airbnb_leads", {
        "thread_id": thread_id,
        "listing_id": listing_id,
        "area": area,
        "stage": stage,
        "contact_id": contact_id,
    })


# ── Public API ────────────────────────────────────────────────────────────────

def log_outreach(listing_id, area, message):
    """
    Called when an initial outreach message is sent to a host.
    listing_id is the Airbnb room ID (used as thread_id until a real thread opens).
    """
    if not _ok():
        return
    cid = ensure_contact(listing_id, f"Airbnb listing {listing_id}")
    if not cid:
        return
    _log_msg(cid, message, direction="outbound", subject=f"Outreach – {area}")
    _ensure_lead(listing_id, cid, listing_id=listing_id, area=area, stage="outreach_sent")


def log_host_message(thread_id, message_body):
    """Called when a new message from the host is detected in a thread."""
    if not _ok() or not message_body:
        return {}
    cid = ensure_contact(thread_id)
    if not cid:
        return {}
    _ensure_lead(thread_id, cid)
    return _log_msg(cid, message_body, direction="inbound", subject="Airbnb Reply")


def log_ai_reply(thread_id, reply_body, stage, inbound_message_id=None):
    """Called after the AI sends a reply. Logs it as outbound + approved pending reply."""
    if not _ok() or not reply_body:
        return
    cid = ensure_contact(thread_id)
    if not cid:
        return
    msg = _log_msg(cid, reply_body, direction="outbound")
    # Mirror into pending_replies as approved so the dashboard has a full audit trail
    if msg and msg.get("id") and inbound_message_id:
        _post("reply_assistant_pending_replies", {
            "contact_id": cid,
            "inbound_message_id": inbound_message_id,
            "draft_body": reply_body,
            "reasoning": f"Auto-sent by Airbnb AI — stage: {stage}",
            "status": "approved",
        })


def update_stage(thread_id, stage):
    """Update the lead's stage in airbnb_leads."""
    if not _ok():
        return
    _patch("airbnb_leads",
           {"thread_id": f"eq.{thread_id}"},
           {"stage": stage, "updated_at": "now()"})


def notify_purchase(thread_id, host_display_name=None):
    """Stage → purchased. Logs a purchase event and updates lead stage."""
    if not _ok():
        print("[lux_bridge] Supabase env not set — skipping")
        return
    cid = ensure_contact(thread_id, host_display_name)
    if not cid:
        return
    _ensure_lead(thread_id, cid)
    update_stage(thread_id, "purchased")
    _log_msg(cid,
             f"[PURCHASE] Host purchased a LuxStudios video flythrough via Airbnb thread {thread_id}. "
             "Awaiting photos to begin production.",
             direction="inbound",
             subject="New Purchase — Awaiting Photos")
    print(f"[lux_bridge] Purchase recorded — thread {thread_id}")


def notify_video_sent(thread_id):
    """Stage → video_sent. Logs delivery and marks lead done."""
    if not _ok():
        return
    cid = ensure_contact(thread_id)
    if not cid:
        return
    update_stage(thread_id, "video_sent")
    _log_msg(cid,
             f"[DELIVERED] Video flythrough delivered to host via Airbnb thread {thread_id}.",
             direction="outbound",
             subject="Video Delivered")
    print(f"[lux_bridge] Delivery logged — thread {thread_id}")
