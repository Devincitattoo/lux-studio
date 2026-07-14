#!/usr/bin/env python3
"""
Airbnb Message API Mapper — discovery + enumeration tool.
Red team use: identify all message API endpoints, their methods, params, and auth requirements.
Requires: pip install requests mitmproxy
"""

import re
import json
import ssl
import time
import requests
import urllib.parse
from typing import Dict, List, Set, Tuple

# ───────────────────────────── │ MITM PROXY MODE │ ─────────────────────────────

"""
Run with: mitmdump -s airbnb_msg_api_map.py --listen-port 8888
Set your browser/system proxy to 127.0.0.1:8888, browse Airbnb as authenticated user.
The script logs and classifies every message API endpoint it sees.
"""

API_PATTERNS = {
    "message_list": ["/api/v2/messages", "/api/graphql", "/api/v2/reservation_messages"],
    "message_send": ["/api/v2/send_message", "/api/v2/messages/send"],
    "conversation_list": ["/api/v2/conversations", "/api/v2/threads"],
    "conversation_detail": ["/api/v2/conversations/", "/api/v2/threads/"],
    "read_receipt": ["/api/v2/read_messages", "/api/v2/mark_read"],
    "attachment_upload": ["/api/v2/upload_message_attachment", "/api/v2/messages/upload"],
    "typing_indicator": ["/api/v2/typing", "/api/v2/conversations/typing"],
}

GRAPHQL_OPERATIONS = [
    "MessageThreadQuery",
    "SendMessageMutation",
    "ConversationsQuery",
    "ThreadMessagesQuery",
    "MarkMessagesReadMutation",
    "DeleteMessageMutation",
    "ReportMessageMutation",
    "BlockUserMutation",
]

class AirbnbMessageEndpointCapture:
    """Passive capture mode — logs real API endpoints seen during browsing."""

    def request(self, flow):
        """Capture request details."""
        url = flow.request.pretty_url
        method = flow.request.method
        headers = dict(flow.request.headers)

        # Filter only airbnb API requests
        if "airbnb.com" not in url:
            return
        if not (url.startswith("https://api.airbnb.com/") or url.startswith("https://www.airbnb.com/api/")):
            return

        # Check for message-related endpoints
        matched = False
        for category, patterns in API_PATTERNS.items():
            for pat in patterns:
                if pat in url:
                    matched = True
                    break
            if matched:
                break

        # Also catch any graphql with message operations
        if not matched and "/api/graphql" in url:
            if flow.request.content:
                try:
                    body = json.loads(flow.request.content)
                    if isinstance(body, dict):
                        op_name = body.get("operationName", "")
                        if "Message" in op_name or "Conversation" in op_name or "Thread" in op_name:
                            matched = True
                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass

        if matched:
            print(f"[!] MESSAGE API CALL — {method} {url}")
            if flow.request.content:
                try:
                    body = json.loads(flow.request.content)
                    print(f"    BODY: {json.dumps(body, indent=2)[:500]}")
                except (json.JSONDecodeError, UnicodeDecodeError):
                    print(f"    RAW BODY: {flow.request.content[:200]}")
            print(f"    HEADERS: {json.dumps(headers, indent=2)[:300]}")
            # Log cookies / auth tokens
            cookies = flow.request.cookies
            for cookie in cookies:
                print(f"    COOKIE: {cookie.name}={cookie.value[:30]}...")

    def response(self, flow):
        """Capture response details — status, shape, error codes."""
        url = flow.request.pretty_url
        if "airbnb.com/api/" not in url and "api.airbnb.com" not in url:
            return

        if not any(pat in url for pat in ["message", "conversation", "thread", "graphql"]):
            return

        print(f"[*] RESPONSE — {flow.response.status_code} {url}")
        if flow.response.content:
            try:
                resp = json.loads(flow.response.content)
                print(f"    PAYLOAD: {json.dumps(resp, indent=2)[:800]}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                print(f"    RAW LEN: {len(flow.response.content)} bytes")

# ───────────────────────── │ ENUMERATOR MODE │ ─────────────────────────

class MessageAPIEnumerator:
    """Active probing mode — tests known and fuzzed endpoints for auth gaps."""

    BASE_AIRBNB = "https://www.airbnb.com"
    API_AIRBNB = "https://api.airbnb.com"

    # Endpoint templates to probe — common patterns
    ENDPOINTS = [
        # REST-style
        "/api/v2/messages",
        "/api/v2/messages/send",
        "/api/v2/conversations",
        "/api/v2/threads",
        "/api/v2/reservation_messages",
        "/api/v2/read_messages",
        "/api/v2/mark_read",
        "/api/v2/send_message",
        "/api/v2/message_threads",
        "/api/v2/typing",
        "/api/v2/upload_message_attachment",
        "/api/v2/delete_message",
        "/api/v2/report_message",
        "/api/v2/block_user",
        # Alternative prefixes
        "/api/v3/messages",
        "/api/v1/messages",
        "/api/messages",
        "/api/messaging",
        "/api/messaging/threads",
        "/api/messaging/conversations",
        "/api/messaging/messages",
        "/api/communcation/messages",
        "/api/inbox",
        "/api/inbox/messages",
        "/api/inbox/threads",
        # Legacy
        "/ws/messages",
        "/messages",
        "/ajax/messages",
        "/ajax/inbox",
        "/ajax/conversations",
    ]

    GRAPHQL_MUTATIONS = [
        "SendMessageMutation",
        "MarkMessagesReadMutation",
        "DeleteMessageMutation",
        "ReportMessageMutation",
        "BlockUserMutation",
        "CreateThreadMutation",
        "AddMessageMutation",
        "ArchiveThreadMutation",
        "UnarchiveThreadMutation",
    ]

    GRAPHQL_QUERIES = [
        "ConversationsQuery",
        "ThreadMessagesQuery",
        "MessageThreadQuery",
        "UnreadMessagesCountQuery",
        "ConversationsListQuery",
        "InboxMessagesQuery",
    ]

    def __init__(self, session_token=None, csrf_token=None, user_agent=None):
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": user_agent or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
        })
        self.s.headers.update({
            "X-Airbnb-API-Key": "d306zoyjsyarp7ifhu67rjxn52tv0t20",
            "X-Airbnb-GraphQL-Platform": "web",
            "X-Airbnb-GraphQL-Platform-Client": "minimalist-niobe",
        })
        if session_token:
            self.s.cookies.set("_airbed_session_id", session_token, domain=".airbnb.com")
        if csrf_token:
            self.s.headers["X-CSRF-Token"] = csrf_token
            self.s.cookies.set("_csrf_token", csrf_token, domain=".airbnb.com")
        self.found_endpoints: Dict[str, dict] = {}

    def _try_rest_endpoint(self, base: str, path: str, method: str = "GET") -> dict:
        """Probe a single REST endpoint."""
        url = urllib.parse.urljoin(base, path)
        try:
            if method == "GET":
                r = self.s.get(url, timeout=10)
            elif method == "POST":
                r = self.s.post(url, json={}, timeout=10)
            else:
                return {"status": "skipped", "method": method, "url": url}

            result = {
                "status_code": r.status_code,
                "method": method,
                "url": url,
                "content_length": len(r.content),
            }
            # Try to parse response body
            if r.text and (r.headers.get("content-type", "").startswith("application/json")
                           or r.text.strip().startswith("{")):
                try:
                    result["json_preview"] = json.loads(r.text[:2000])
                except:
                    result["text_preview"] = r.text[:300]

            # Classify by response
            if r.status_code == 200:
                if "error" not in r.text.lower()[:200]:
                    result["status"] = "LIVE_UNAUTH" if not self.s.cookies.get("session_token") else "LIVE_AUTH"
                else:
                    result["status"] = "ERROR_RESPONSE"
            elif r.status_code == 401:
                result["status"] = "AUTH_REQUIRED"
            elif r.status_code == 403:
                result["status"] = "FORBIDDEN"
            elif r.status_code == 404:
                result["status"] = "NOT_FOUND"
            elif r.status_code in (405, 501):
                result["status"] = "WRONG_METHOD"
            elif r.status_code == 429:
                result["status"] = "RATE_LIMITED"
            elif r.status_code == 302:
                result["status"] = "REDIRECT"
            else:
                result["status"] = f"UNKNOWN_{r.status_code}"

            return result
        except requests.exceptions.ConnectionError:
            return {"status": "CONNECTION_FAILED", "url": url}
        except requests.exceptions.Timeout:
            return {"status": "TIMEOUT", "url": url}
        except Exception as e:
            return {"status": "EXCEPTION", "url": url, "error": str(e)}

    def _try_graphql(self, operation_name: str, query: str, variables: dict = None) -> dict:
        """Probe a GraphQL endpoint with a specific operation."""
        url = f"{self.API_AIRBNB}/api/graphql"
        payload = {
            "operationName": operation_name,
            "variables": variables or {"id": None, "limit": 1, "offset": 0, "threadId": None},
            "query": query,
        }
        try:
            r = self.s.post(url, json=payload, timeout=10)
            result = {
                "operation_name": operation_name,
                "status_code": r.status_code,
                "url": url,
            }
            if r.text:
                try:
                    result["json_preview"] = json.loads(r.text[:2000])
                except:
                    result["text_preview"] = r.text[:300]

            if r.status_code == 200 and "errors" not in r.text[:500]:
                result["status"] = "GRAPHQL_LIVE"
            else:
                result["status"] = f"GRAPHQL_{r.status_code}"

            return result
        except Exception as e:
            return {"status": "GRAPHQL_FAIL", "error": str(e)}

    def enumerate_rest(self, base: str = BASE_AIRBNB) -> dict:
        """Enumerate all REST endpoint patterns."""
        print(f"[*] Enumerating REST endpoints at {base} ...")
        for ep in self.ENDPOINTS:
            for method in ("GET", "POST"):
                key = f"{method} {ep}"
                if key not in self.found_endpoints:
                    print(f"    [{method}] {ep}")
                    result = self._try_rest_endpoint(base, ep, method)
                    self.found_endpoints[key] = result
                    # If it's a live endpoint, dump the preview
                    if "LIVE" in str(result.get("status", "")):
                        print(f"    >>> LIVE: status={result['status_code']}, json={result.get('json_preview', result.get('text_preview', ''))[:200]}")
                    time.sleep(0.5)
        return self.found_endpoints

    def enumerate_graphql(self) -> dict:
        """Probe GraphQL operations (requires query SDL — uses introspection patterns)."""
        # Generic introspection probe first
        intro_query = """
        query IntrospectionQuery {
            __schema {
                types { name kind }
                queryType { name }
                mutationType { name }
            }
        }
        """
        print("[*] Probing GraphQL introspection ...")
        result = self._try_graphql("IntrospectionQuery", intro_query, {})
        preview = result.get('json_preview', '')
        if isinstance(preview, dict): preview = json.dumps(preview)
        print(f"    Introspection: {result.get('status')} — {str(preview)[:300]}")

        # If we have introspection results, parse out message operations
        if result.get("status") == "GRAPHQL_LIVE":
            schema = result.get("json_preview", {})
            print("[*] GraphQL introspection succeeded — parsing message types and mutations.")
            # We'll just dump what we can
            return {"introspection": result}

        # Fallback: probe known operation names with minimal queries
        print("[*] Introspection blocked — probing known operation names ...")
        for op in self.GRAPHQL_QUERIES + self.GRAPHQL_MUTATIONS:
            print(f"    [{op}]")
            # Simple generic query: just fetch the operation name
            if "Mutation" in op:
                gql = f"mutation {op}($input: JSON) {{ {op}(input: $input) {{ ok }} }}"
            else:
                gql = f"query {op} {{ __typename }}"
            r = self._try_graphql(op, gql, {})
            self.found_endpoints[f"GRAPHQL {op}"] = r
            if r.get("status") == "GRAPHQL_LIVE":
                print(f"    >>> LIVE: {r}")
            time.sleep(0.5)
        return self.found_endpoints

    def fuzz_paths(self, base: str = BASE_AIRBNB) -> dict:
        """Fuzz for hidden message endpoints."""
        fuzz_patterns = [
            "/api/v2/messages/{id}",
            "/api/v2/conversations/{id}",
            "/api/v2/threads/{id}/messages",
            "/api/v2/conversations/{id}/messages",
            "/api/v2/messages/{id}/read",
            "/api/v2/users/{uid}/messages",
            "/api/v2/listings/{lid}/messages",
            "/api/v2/reservations/{rid}/messages",
            "/api/v2/reservation/{rid}/message_thread",
            "/api/v2/messaging/contacts",
            "/api/v2/messaging/blocked_users",
        ]
        print("[*] Fuzzing parameterized endpoints with test IDs ...")
        test_ids = ["1", "test", "abc123", "me"]
        results = {}
        for pattern in fuzz_patterns:
            for tid in test_ids:
                path = pattern.replace("{id}", tid).replace("{uid}", tid).replace("{lid}", tid).replace("{rid}", tid)
                print(f"    [GET] {path}")
                r = self._try_rest_endpoint(base, path)
                results[path] = r
                if "LIVE" in str(r.get("status", "")):
                    print(f"    >>> LIVE: {r}")
                time.sleep(0.3)
        return results

    def run_full(self):
        """Run all enumeration steps and print summary."""
        print("=" * 60)
        print("Airbnb Message API Mapper — Full Enumeration")
        print("=" * 60)

        rest = self.enumerate_rest()
        gql = self.enumerate_graphql()
        fuzz = self.fuzz_paths()

        # Summary
        print("\n" + "=" * 60)
        print("SUMMARY — Live Endpoints")
        print("=" * 60)
        all_results = {**rest, **gql, **fuzz}
        live = {k: v for k, v in all_results.items()
                if any(s in str(v.get("status","")) for s in ("LIVE","GRAPHQL_LIVE","AUTH_REQUIRED","REDIRECT","RATE_LIMITED"))}

        if live:
            print(f"\n  {'KEY':<50} {'STATUS':<20} CODE  PREVIEW")
            print(f"  {'-'*50} {'-'*20} ----  -------")
            for key, val in live.items():
                code    = val.get("status_code", "")
                status  = val.get("status", "")
                preview = str(val.get("json_preview", val.get("text_preview", "")))[:80]
                print(f"  {str(key):<50} {status:<20} {str(code):<5} {preview}")
        else:
            print("  No live/auth-required endpoints found.")

        auth_required = {k: v for k, v in all_results.items() if v.get("status") == "AUTH_REQUIRED"}
        if auth_required:
            print(f"\n[*] Auth-gated endpoints (need valid session) — {len(auth_required)}:")
            for k in auth_required:
                print(f"  {k}")

        print(f"\n[*] Total endpoints probed: {len(all_results)}")
        return all_results

if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "enum"

    if mode == "capture":
        # mitmproxy addon mode
        print("[*] Starting mitmproxy capture addon. Load with: mitmdump -s airbnb_msg_api_map.py")
        addons = [AirbnbMessageEndpointCapture()]
    elif mode == "enum":
        token = sys.argv[2] if len(sys.argv) > 2 else None
        csrf = sys.argv[3] if len(sys.argv) > 3 else None
        en = MessageAPIEnumerator(session_token=token, csrf_token=csrf)
        en.run_full()
    else:
        print("Usage:")
        print("  Passive capture:   mitmdump -s airbnb_msg_api_map.py")
        print("  Active enumeration: python airbnb_msg_api_map.py enum [session_token] [csrf_token]")
